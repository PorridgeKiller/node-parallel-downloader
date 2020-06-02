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

    debug(message?: any, ...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        console.debug('[debug]', message, ...args);
    };

    info(message?: any, ...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        console.info('[info]', message, ...args);
    };

    warn(message?: any, ...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        console.warn('[warn]', message, ...args);
    };

    error(message?: any, ...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        console.error('[debug]', message, ...args);
    };

    printStackTrace(): void {
        if (this.disabled()) {
            return;
        }
    }

    assert(condition: boolean, ...errorArgs: any[]): void {

    }

    disabled() {
        return false;
    }

    setDisabled(disabled: boolean): void {
    }

    setProxy(logger: LoggerInterface) {

    }
}



class DownloadLogger implements LoggerInterface {
    private _disabled = false;
    public logger: LoggerInterface = new ConsoleLogger();

    debug(message?: any, ...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        this.logger && this.logger.debug(message, ...args);
    };

    info(message?: any, ...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        this.logger && this.logger.info(message, ...args);
    };

    warn(message?: any, ...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        this.logger && this.logger.warn(message, ...args);
    };

    error(message?: any, ...args: any[]): void {
        if (this.disabled()) {
            return;
        }
        this.logger && this.logger.error(message, ...args);
    };

    printStackTrace(): void {
    }

    assert(condition: boolean, ...errorArgs: any[]): void {
    }

    disabled() {
        return this._disabled;
    }

    setDisabled(disabled: boolean): void {
        this._disabled = disabled;
    }

    setProxy(logger: LoggerInterface) {
        this.logger = logger;
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
    ConsoleLogger,
    LoggerInterface,
    DownloadTaskGroup,
    DownloadTask,
    DownloadWorker,
}