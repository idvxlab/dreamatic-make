declare module "@jscad/modeling" {
  const modeling: any;
  export default modeling;
}
declare module "@jscad/stl-serializer" {
  export function serialize(
    options: { binary: boolean },
    geometry: unknown,
  ): (string | ArrayBuffer)[];
}
