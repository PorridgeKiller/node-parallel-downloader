/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-18 17:37
 */

import * as crypto from 'crypto';
import Logger from './util/Logger';
import DownloadManager from './DownloadManager';
import DownloadTask from './DownloadTask';
import DownloadWorker from './DownloadWorker';

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
    MERGE = 'MERGE',
}


export enum DownloadEvent {
    ERROR = 'ERROR',
    STARTED = 'STARTED',
    STOP = 'STOP',
    FINISHED = 'FINISHED',
    CANCELED = 'CANCELED',
    PROGRESS = 'PROGRESS',
    MERGE = 'MERGE',
}


export class ErrorMessage {
    public code: string;
    public message: string;
    public taskId?: string;
    public error: NodeJS.ErrnoException;

    constructor(code: string, message: string, error: NodeJS.ErrnoException) {
        this.code = code;
        this.message = message;
        this.error = error;
    }

    public static fromCustomer(code: string, message: string, error: NodeJS.ErrnoException) {
        return new ErrorMessage(code, message, error);
    }

    public static fromErrorEnum(errEnum: DownloadErrorEnum, error: NodeJS.ErrnoException) {
        const str = errEnum.toString();
        const strs = str.split('@');
        return new ErrorMessage(strs[0], strs[1], error);
    }
}

export enum DownloadErrorEnum {
    DESCRIBE_FILE_ERROR = '1000@error occurred when fetching file description',
    REQUEST_TIMEOUT = '1001@request timeout',
    UNKNOWN_PROTOCOL = '1002@unknown protocol',
    SERVER_UNAVAILABLE = '1003@server unavailable',
    CREATE_DOWNLOAD_DIR_ERROR = '1004@failed to create download directory',
    READ_CHUNK_FILE_ERROR = '1005@failed to read chunk file',
    WRITE_CHUNK_FILE_ERROR = '1006@failed to write into chunk file',
    APPEND_TARGET_FILE_ERROR = '1007@failed to append target file',
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
    computed: {
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

const httpHeaderFileInformationDescriptor: FileInformationDescriptor = async (descriptor: FileDescriptor) => {


    return descriptor;
};


const defaultTaskIdGenerator: TaskIdGenerator = async (downloadUrl: string, storageDir: string, filename: string) => {
    return crypto.createHash('md5').update(downloadUrl).digest('hex');
};

export {
    defaultFileInformationDescriptor, defaultTaskIdGenerator
}



export {
    Logger,
    DownloadManager,
    DownloadTask,
    DownloadWorker,
}