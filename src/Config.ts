/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-18 17:37
 */

import * as crypto from 'crypto';
import LoggerInterface from './util/LoggerInterface';
import DownloadTaskGroup from './DownloadTaskGroup';
import DownloadTask from './DownloadTask';
import DownloadWorker from './DownloadWorker';


class ConsoleLogger implements LoggerInterface {
    private _disabled: boolean = false;

    debug(...args: any[]): void {
        console.debug('[debug]', ...args);
    };

    info(...args: any[]): void {
        console.info('[info ]', ...args);
    };

    warn(...args: any[]): void {
        console.warn('[warn ]', ...args);
    };

    error(...args: any[]): void {
        console.error('[error]', ...args, getStackTrace('invoke-stack-trace:'));
    };

    printStackTrace(...args: any[]): void {
        console.info('[trace]', ...args, getStackTrace('invoke-stack-trace:'));
    }

    assert(condition: boolean, ...errorArgs: any[]): void {
        if (condition) {
            return;
        }
        console.error('[assert]', ...errorArgs, getStackTrace('invoke-stack-trace:'));
    }

    disabled() {
        return this._disabled;
    }

    setDisabled(disabled: boolean): void {
        this._disabled = disabled;
    }

    setProxy(proxy: LoggerInterface) {

    }
}

const getStackTrace = (prefix: string) => {
    const obj: any = {};
    Error.captureStackTrace(obj, getStackTrace);
    let stackStr = obj.stack;
    for (let i = 0; i < 3; i++) {
        stackStr = stackStr.substring(stackStr.indexOf('\n') + 1);
    }
    if (prefix) {
        stackStr = prefix.concat('\n').concat(stackStr)
    } else {
        stackStr = '\n'.concat(stackStr);
    }
    return stackStr;
};


class DownloadLogger implements LoggerInterface {
    public proxy: LoggerInterface = new ConsoleLogger();

    debug(...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        this.proxy && this.proxy.debug(...args);
    };

    info(...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        this.proxy && this.proxy.info(...args);
    };

    warn(...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        this.proxy && this.proxy.warn(...args);
    };

    error(...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        this.proxy && this.proxy.error(...args);
    };

    printStackTrace(...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        this.proxy && this.proxy.printStackTrace(...args);
    }

    assert(condition: boolean, ...errorArgs: any[]): void {
        if (this.disabled()) {
            return;
        }
        this.proxy && this.proxy.assert(condition, ...errorArgs);
    }

    disabled() {
        return this.proxy.disabled();
    }

    setDisabled(disabled: boolean): void {
        this.proxy.setDisabled(disabled);
    }

    setProxy(proxy: LoggerInterface) {
        this.proxy = proxy;
    }
}

const Logger: LoggerInterface = new DownloadLogger();



export const Config = {
    INFO_FILE_EXTENSION: '.info.json',
    BLOCK_FILENAME_EXTENSION: '.tmp',
};


export enum DownloadStatus {
    INIT = 'INIT',
    DOWNLOADING = 'DOWNLOADING',
    STOPPED = 'STOPPED',
    MERGING = 'MERGING',
    FINISHED = 'FINISHED',
    CANCELED = 'CANCELED',
    ERROR = 'ERROR',
}


export enum DownloadEvent {
    STARTED = 'STARTED',
    STOP = 'STOP',
    MERGE = 'MERGE',
    FINISHED = 'FINISHED',
    CANCELED = 'CANCELED',
    PROGRESS = 'PROGRESS',
    ERROR = 'ERROR',
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
    DELETE_CHUNK_FILE_ERROR = '1007@failed to delete chunk file',
    APPEND_TARGET_FILE_ERROR = '1008@failed to append target file',
    FAILED_TO_RESUME_TASK = '1009@failed to resume download task',
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
    ConsoleLogger,
    LoggerInterface,
    DownloadTaskGroup,
    DownloadTask,
    DownloadWorker,
}