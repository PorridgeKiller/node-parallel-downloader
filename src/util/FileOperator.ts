/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-23 11:48
 */
import * as fs from 'fs';
import * as path from 'path';


export function createNewFile(filePath: string) {
    fs.createWriteStream(filePath).close();
}

export function openReadStream(filePath: string): fs.ReadStream {
    return fs.createReadStream(filePath);
}

export function openAppendStream(filePath: string): fs.WriteStream {
    return fs.createWriteStream(filePath, {
        flags: 'a'
    });
}

export function openWriteStream(filePath: string): fs.WriteStream {
    return fs.createWriteStream(filePath);
}


export async function doWriteStream(ws: fs.WriteStream, chunk: any) {
    return new Promise((resolve, reject) => {
        ws.write(chunk, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// 递归创建目录 异步方法
export async function mkdirsIfNonExistsAsync(dirPath: string): Promise<boolean> {
    if (await existsAsync(dirPath, true)) {
        return true;
    }
    if (await mkdirsIfNonExistsAsync(path.dirname(dirPath))) {
        return new Promise<boolean>((resolve, reject) => {
            fs.mkdir(dirPath, async (err: NodeJS.ErrnoException | null) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(true);
                }
            });
        });
    }
    return false;
}

/**
 * 是否存在指定文件
 * @param filePath 要判断的文件绝对路径
 * @param isDirectory 是否期望为目录
 */
export async function existsAsync(filePath: string, isDirectory?: boolean): Promise<boolean> {
    const exists = await new Promise<boolean>((resolve, reject) => {
        fs.exists(filePath, resolve);
    });
    if (!exists) {
        return false;
    }
    return new Promise((resolve, reject) => {
        fs.stat(filePath, (err, stat) => {
            if (err) {
                reject(err);
            } else {
                if (isDirectory) {
                    resolve(stat.isDirectory());
                } else {
                    resolve(stat.isFile());
                }
            }
        });
    });
}


export async function deleteFileOrDirAsync(fileOrDirPath: string): Promise<any> {
    // 如果当前文件不存在，则退出
    const exists = await new Promise((resolve, reject) => {
        fs.exists(fileOrDirPath, (exists) => {
            resolve(exists);
        });
    });
    if (!exists) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        fs.stat(fileOrDirPath, async (err, stat) => {
            if (err) {
                resolve(err);
                return;
            }
            if (!stat) {
                resolve();
                return;
            }
            if (stat.isDirectory()) {
                const err1 = await deleteDirectory(fileOrDirPath);
                resolve(err1);
            } else {
                const parsed = path.parse(fileOrDirPath);
                const filename = parsed.name + (parsed.ext ? parsed.ext : '');
                const dir = parsed.dir ? parsed.dir : '';
                const err2 = await deleteFile(dir, filename);
                resolve(err2);
            }
        });
    });
}

export function deleteDirectory(dirPath: string) {
    return new Promise((resolve, reject) => {
        fs.access(dirPath, (err1) => {
            if (err1) {
                resolve(err1);
                return;
            }
            fs.readdir(dirPath, async (err2, files) => {
                if (err2) {
                    resolve(err2);
                    return;
                }
                for (let i = 0; i < files.length; i++) {
                    const err3 = await deleteFile(dirPath, files[i]);
                    if (err3) {
                        resolve(err3);
                        return;
                    }
                }
                fs.rmdir(dirPath, (err4) => {
                    if (err4) {
                        resolve(err4);
                        return;
                    }
                    resolve();
                });
            })
        })
    })
}

export function deleteFile(dirPath: string, file: string) {
    return new Promise((resolve, reject) => {
        let filePath = path.join(dirPath, file);
        fs.stat(filePath, (err1, stat) => {
            if (err1) {
                resolve(err1);
                return;
            }
            if (!stat) {
                resolve();
                return;
            }
            if (stat.isFile()) {
                fs.unlink(filePath, (err2) => {
                    if (err2) {
                        resolve(err2);
                        return;
                    }
                    resolve();
                })
            } else {
                //返回deleteDirectory在all中递归调用
                resolve(deleteDirectory(filePath));
            }
        })
    });
}

/**
 * 异步读文件
 * @param filePath
 * @param options typeof fs.WriteFileOptions
 */
export async function readFileAsync(filePath: string, options?: any): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, options, (err, data: string) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

/**
 * 异步写内容到文件
 * @param filePath
 * @param text
 * @param options typeof fs.WriteFileOptions
 */
export async function writeFileAsync(filePath: string, text: string, options?: any) {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, text, options, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}


export async function appendFile(filePath: string, data: any,) {
    return new Promise((resolve, reject) => {
        fs.appendFile(filePath, data, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

export async function fileLengthAsync(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        fs.stat(filePath, (err, stat) => {
            if (err) {
                resolve(-1);
            } else {
                resolve(stat.size);
            }
        });
    });
}


export async function isFile(filePath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        fs.stat(filePath, (err, stat) => {
            if (err) {
                reject();
                return;
            }
            if (!stat) {
                reject(new Error('stat == null'));
                return;
            }
            resolve(stat.isFile());
        });
    });
}


/**
 * 拼接字符串数组为路径
 * @param paths
 */
export function pathJoin(...paths: string[]) {
    let p = '';
    if (paths) {
        paths.map((s) => p = path.join(p, s));
    }
    return p;
}


export async function listSubFilesAsync(dirPath: string): Promise<string[]> {
    return await new Promise((resolve, reject) => {
        fs.readdir(dirPath, null, async (readErr: NodeJS.ErrnoException | null, children: string[]) => {
            if (readErr) {
                reject(readErr);
                return;
            }
            const files = [];
            for (let i = 0; i < children.length; i++) {
                const filename = children[i];
                const fullpath = pathJoin(dirPath, filename);
                if (await isFile(fullpath)) {
                    files.push(fullpath);
                }
            }
            resolve(files.sort((fileA, fileB) => {
                return fileA.localeCompare(fileB);
            }));
        });
    });
}

// export async function appendFile(filePath: string, chunk: any) {
//
//     return new Promise((resolve, reject) => {
//         fs.appendFile()
//         fs.open(filePath, 'a+', () => {
//
//         });
//         fs.closeSync()
//     });
// }

type WriteStream = fs.WriteStream

export {
    WriteStream
};