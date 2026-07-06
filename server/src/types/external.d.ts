// 外部无声明文件模块的类型补充
declare module "adm-zip" {
  class AdmZip {
    constructor(filePath?: string | Buffer);
    extractAllTo(targetPath: string, overwrite?: boolean): void;
    addFile(filePath: string, content: Buffer): void;
    writeZip(filePath?: string): void;
  }
  export = AdmZip;
}
