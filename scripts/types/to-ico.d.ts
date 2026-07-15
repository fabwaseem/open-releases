declare module "to-ico" {
  export default function toIco(
    buffers: Buffer[],
    options?: { resize?: boolean; sizes?: number[] }
  ): Promise<Buffer>
}
