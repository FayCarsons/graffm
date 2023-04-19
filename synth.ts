import { mtof, randInt, randNth, log } from './utilities';


/* TODO:
 * -make gain matrix sparse DONE
 * -note allocation DONE(?)
 * -scale matrix gain nodes w velocity
 * -graph operations
 * -handle drum mode
 */

const PRESETS: Array<Record<number, number[] | string[]>> = [
  { 0: ['out'], 1: [0], 2: ['out'], 3: [2], 4: [3], 5: [4, 5] },
  { 0: ['out'], 1: [0, 1], 2: ['out'], 3: [2], 4: [3], 5: [4] },
  { 0: ['out'], 1: [0], 2: [1], 3: ['out'], 4: [3], 5: [4, 5] },
  { 0: ['out'], 1: [0], 2: [1], 3: ['out'], 4: [], 5: [] },
];

const INIT_FREQ = 220;
const INIT_MOD_GAIN = 50;
const INIT_OUTPUT_GAIN = 0.1;

enum Mode {
  "mono",
  "poly",
  "drum",
}

class Voice {
  operators: Array<OscillatorNode>;
  ratios: Array<number>;
  algorithm: Record<number, number[] | string[]>;
  matrix: Array<Array<GainNode>>;
  vca: GainNode;

  constructor(
    context: AudioContext,
    ratios: Array<number>,
    operators?: number,
    algorithm?: Record<number, number[] | string[]>
  ) {
    if (!operators) {
      operators = 6;
    }

    this.operators = Array(operators)
      .fill(0)
      .map(() => {
        return context.createOscillator();
      });

    this.ratios = ratios;

    this.algorithm = algorithm || randNth(PRESETS);

    this.matrix = Array(operators)
      .fill(0)
      .map(() => {
        return Array(operators)
          .fill(0)
          .map(() => {
            return context.createGain();
          });
      });

    this.vca = context.createGain();
  }

  //  output gain node still needs to be connected to audio destination externally
  init(outputNode: GainNode): void {
    //set each oscillator value
    this.operators.forEach((osc, i) => {
      if (i === 0) {
        osc.frequency.value = INIT_FREQ;
      } else {
        osc.frequency.value = Math.floor(INIT_FREQ * this.ratios[i]);
      }

      //connect each to its row of gain objects
      for (const target of this.algorithm[i]) {
        if (typeof target === "number") {
          osc.connect(this.matrix[i][target]);
          this.matrix[i][target].connect(this.operators[target].frequency);
          this.matrix[i][target].gain.value = i === target ? 0.05 : INIT_MOD_GAIN * randInt(2, 5);
          continue;
        } else if (target === 'out') {
          osc.connect(this.vca);
          continue;
        } else if (target !== null || undefined) {
          throw new Error("malformed algorithm");
        } else {
          continue;
        }
      }
    });

    this.vca.gain.value = 0;
    this.vca.connect(outputNode);
    this.operators.map((osc) => osc.start());
  }

  play(now: number, midiNote: number, velocity: number, decay: number): void {
    let frequency = mtof(midiNote);
    this.vca.gain.linearRampToValueAtTime(velocity / 127, now + 0.05);

    this.operators.forEach((osc, i) => {
      osc.frequency.value =
        i === 0 ? frequency : Math.floor(frequency * this.ratios[i]);
    });

    for (const [operator, target] of Object.entries(this.algorithm)) {
      let x = parseInt(operator);
      for (const y of target) {
        if (typeof y === "number") {
          let gain = this.matrix[x][y].gain;
          gain.linearRampToValueAtTime(velocity, now + 0.05)
          gain.exponentialRampToValueAtTime(1e-45, now + decay);
          //gain.setValueAtTime(velocity, now + decay + 0.5);
        }
      }
    }

    this.vca.gain.linearRampToValueAtTime(0.0, now + decay + 0.1);
  }
}

export class Synth {
  context: AudioContext;
  mode: Mode;
  algorithm?: Record<number, number[] | string[]>;
  operators?: number;
  ratios: number[];

  voices: Voice[];
  voiceTimestamps: number[];

  midiChannel?: number;

  decay?: number;

  outputNode: GainNode;
  outputGain: number;
  delay?: boolean;
  delayNode?: DelayNode;
  delayRate?: number;
  delayFeedback?: GainNode;

  constructor(
    context: AudioContext,
    mode: String,
    voices: number,
    algorithm?: Record<number, number[] | string[]>,
    operators?: number,
    ratios?: number[],
    midiChannel?: number,
    delay?: boolean
  ) {
    this.midiChannel = midiChannel || 1;

    if (delay) {
      this.delay = true;
    }

    this.context = context;

    switch (mode.toLowerCase()) {
      case "mono":
        this.mode = Mode.mono;
        break;
      case "poly":
        this.mode = Mode.poly;
        break;
      case "drum":
        this.mode = Mode.drum;
        break;
      default:
        throw new Error("invalid synth mode");
    }
    this.operators = operators || 6;
    
    this.ratios = ratios || Array(this.operators)
      .fill(0)
      .map((_, i) => {
        return i === 0 ? 1 : randInt(2, 16);
      })
    

    this.voices = Array(voices)
      .fill(0)
      .map(() => {
        return new Voice(context, this.ratios, operators);
      });

    let alg: Record<number, number[] | string[]> = algorithm || PRESETS[0];
    this.algorithm = alg;
    for (const voice of this.voices) {
      voice.algorithm = alg;
    }
    this.voiceTimestamps = Array(voices).fill(0);
    this.outputNode = context.createGain();
    this.outputGain = INIT_OUTPUT_GAIN;
  }

  init(): void {
    for (const voice of this.voices) {
      voice.init(this.outputNode);
    }

    this.outputNode.gain.value = INIT_OUTPUT_GAIN;

    if (this.delay) {
      this.delayNode = this.context.createDelay(10);
      this.delayNode.delayTime.value = this.delayRate || 0.5;
      this.delayNode.connect(this.context.destination);
      this.delayFeedback = this.context.createGain();
      this.delayFeedback.gain.value = 0.8;
      this.delayFeedback.connect(this.delayNode);
      this.delayNode.connect(this.delayFeedback);
      this.outputNode.connect(this.context.destination);
    }

    this.outputNode.connect(
      this.delayNode ? this.delayNode : this.context.destination
    );
  }

  initMidi(midiChannel?: number): void {
    this.midiChannel = midiChannel || 0;
    window.navigator
      .requestMIDIAccess()
      .then((midiAccess: any) => {
        console.log("midi enabled");
        for (const entry of midiAccess.inputs) {
          entry[1].onmidimessage = (midiEvent: any) => {
            this.playMidi(midiEvent);
          };
        }
      })
      .catch((error: Error) => {
        console.log("error accessing midi devices: " + error);
      });
  }

  play(
    midiNote: number,
    velocity: number,
    decay: number,
    outputGain: number
  ): void {
    let now = this.context.currentTime;

    // get min of array with apply or [...Array]
    // should return first checked if all are ==
    let oldestVoice = Math.min(...this.voiceTimestamps);
    let oldestIndex = this.voiceTimestamps.indexOf(oldestVoice);
    this.voices[oldestIndex].play(now, midiNote, velocity, decay);
    this.voiceTimestamps[oldestIndex] = now;

    this.outputGain = outputGain;
    this.outputNode.gain.value = this.outputGain;
  }

  playMidi(midiEvent: any): void {
    let data: Uint8Array = midiEvent.data;
    if (data.length === 3) {
      // status is first byte
      let status = data[0];
      // command is four most significant bits of the status byte
      let command = status >> 4;
      // channel is the lower four bits
      let channel = status & 0xf;

      // only consider note on and note off
      if (command === 0x9 && channel === (this.midiChannel || 0)) {
        let note = data[1];
        let velocity = data[2];
        this.play(note, velocity, this.decay || 2, this.outputGain);
      }
    }
  }
}

export default Synth;
