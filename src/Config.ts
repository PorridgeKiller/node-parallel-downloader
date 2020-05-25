/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-18 17:37
 */

import * as crypto from 'crypto';

export const Config = {
    INFO_FILE_EXTENSION: '.info.json',
    BLOCK_FILENAME_EXTENSION: '.tmp',
};


export enum DownloadStatus {
    STOP = 'STOP',
    INIT = 'INIT',
    FINISHED = 'FINISHED',
    DOWNLOADING = 'DOWNLOADING',
    CANCEL = 'CANCEL',
    ERROR = 'ERROR',
}


export enum DownloadEvent {
    ERROR = 'ERROR',
    STARTED = 'STARTED',
    FINISHED = 'FINISHED',
    CANCELED = 'CANCELED',
    ABORT = 'ABORT',
    PROGRESS = 'PROGRESS',
    DESCRIPTOR_ASSEMBLED = 'DESCRIPTOR_ASSEMBLED',
}


export class ErrorMessage {
    private code: string;
    private message: string;

    constructor(code: string, message: string) {
        this.code = code;
        this.message = message;
    }

    public static fromCustomer(code: string, message: string) {
        return new ErrorMessage(code, message);
    }

    public static fromErrorEnum(errEnum: DownloadErrorEnum) {
        const str = errEnum.toString();
        const strs = str.split('@');
        return new ErrorMessage(strs[0], strs[1]);
    }
}

export enum DownloadErrorEnum {
    REQUEST_TIMEOUT = '1000@request timeout',
    UNKNOWN_PROTOCOL = '1001@unknown protocol',
    SERVER_UNAVAILABLE = '1002@server unavailable',
    CREATE_DOWNLOAD_DIR_FAILED = '1003@下载目录创建失败',
    READ_CHUNK_FILE_ERROR = '1004@读取块文件出错',
    WRITE_CHUNK_FILE_ERROR = '1005@写入块文件出错',
    APPEND_TARGET_FILE_ERROR = '1006@追加目标文件出错',
}



declare type TaskIdGenerator = (downloadUrl: string, storageDir: string, filename: string) => Promise<string>;

declare type FileInformationDescriptor = (descriptor: FileDescriptor) => Promise<FileDescriptor>;

export {
    TaskIdGenerator, FileInformationDescriptor
}


export interface FileDescriptor {
    taskId: string;
    configDir: string;
    downloadUrl: string;
    storageDir: string;
    filename: string;
    chunks: number;
    contentType: string;
    contentLength: number;
    md5: string;
    createTime: Date;
    computed?: {
        chunksInfo: ChunkInfo[];
    }
}

export interface ChunkInfo {
    index: number;
    length: number;
    from: number;
    to: number;
}


const defaultFileInformationDescriptor: FileInformationDescriptor = async (descriptor: FileDescriptor) => {
    descriptor.contentType = 'application/zip';
    descriptor.contentLength = 855400185;
    const md5 = crypto.createHash('md5');
    descriptor.md5 = md5.update(descriptor.downloadUrl).digest('hex');
    return descriptor;
};


const defaultTaskIdGenerator: TaskIdGenerator = async (downloadUrl: string, storageDir: string, filename: string) => {
    return crypto.createHash('md5').update(downloadUrl).digest('hex');
};

export {
    defaultFileInformationDescriptor, defaultTaskIdGenerator
}


console.log('heh');