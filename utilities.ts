export const log = (a: any): any => {
    console.log(a);
    return a;
};
  
export const randInt = (min: number, max: number): number => {
    return Math.floor(min + Math.random() * (max - min));
};
  
export const randNth = (arr: any[]) => {
    let index = randInt(0, arr.length);
    return arr[index];
};

export const mtof = (note: number): number => {
    return Math.pow(2, (note - 69) / 12) * 440;
};

export default {log, randInt, randNth, mtof};