/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-18 17:37
 */
import http from 'http';
import * as crypto from 'crypto';
import LoggerInterface from './util/LoggerInterface';
import DownloadTaskGroup from './DownloadTaskGroup';
import DownloadTask from './DownloadTask';
import DownloadWorker from './DownloadWorker';
import requestMethodHeadFileInformationDescriptor from './impl/RequestHeadFileInformationDescriptor';
import * as CommonUtils from './util/CommonUtils';

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
        return !this.proxy || this.proxy.disabled();
    }

    setDisabled(disabled: boolean): void {
        this.proxy && this.proxy.setDisabled(disabled);
    }

    setProxy(proxy: LoggerInterface) {
        this.proxy = proxy;
    }
}

const Logger: LoggerInterface = new DownloadLogger();



export const Config = {
    INFO_FILE_EXTENSION: '.down.json',
    BLOCK_FILENAME_EXTENSION: '.tmp',
};


export enum DownloadStatus {
    INIT = 'INIT',
    STARTED = 'STARTED',
    DOWNLOADING = 'DOWNLOADING',
    STOPPED = 'STOPPED',
    MERGING = 'MERGING',
    FINISHED = 'FINISHED',
    CANCELED = 'CANCELED',
    RENAMING = 'RENAMING',
    ERROR = 'ERROR',
}


export enum DownloadEvent {
    INITIALIZED = 'INITIALIZED',
    STARTED = 'STARTED',
    DOWNLOADING = 'DOWNLOADING',
    PROGRESS = 'PROGRESS',
    STOPPED = 'STOPPED',
    MERGE = 'MERGE',
    FINISHED = 'FINISHED',
    CANCELED = 'CANCELED',
    ERROR = 'ERROR',
}


export class ErrorMessage {
    public taskId?: string;
    public code: string;
    public message: string;
    public type: string;
    public error: NodeJS.ErrnoException;

    constructor(code: string, message: string, type: string, error: NodeJS.ErrnoException) {
        this.code = code;
        this.message = message;
        this.type = type;
        this.error = error;
    }

    public static fromCustomer(code: string, message: string, type: string, error: NodeJS.ErrnoException) {
        return new ErrorMessage(code, message, type, error);
    }

    public static fromErrorEnum(errEnum: DownloadErrorEnum, error: NodeJS.ErrnoException) {
        const str = errEnum.toString();
        const strs = str.split('@');
        return new ErrorMessage(strs[0], strs[2], strs[1], error);
    }
}

export enum DownloadErrorEnum {
    SYSTEM_ERROR = '9999@generic@system error',
    DESCRIBE_FILE_ERROR = '1000@generic@error occurred when fetching file description',
    REQUEST_TIMEOUT = '1001@retry@request timeout',
    UNKNOWN_PROTOCOL = '1002@request@unknown protocol',
    SERVER_UNAVAILABLE = '1003@retry@server unavailable',
    CREATE_DOWNLOAD_DIR_ERROR = '1004@file@failed to create download directory',
    READ_CHUNK_FILE_ERROR = '1005@file@failed to read chunk file',
    WRITE_CHUNK_FILE_ERROR = '1006@file@failed to write into chunk file',
    DELETE_CHUNK_FILE_ERROR = '1007@file@failed to delete chunk file',
    APPEND_TARGET_FILE_ERROR = '1008@file@failed to append target file',
    RENAME_MERGED_FILE_ERROR = '1009@file@failed to rename merged file to target filename',
    FAILED_TO_RESUME_TASK = '1010@task@failed to resume download task',
    NO_SPACE_LEFT_ON_DEVICE = '1011@fatal@no space left on device',
}



declare type TaskIdGenerator = (downloadUrl: string, storageDir: string, filename: string | undefined, attachment?: any) => Promise<string>;

declare type FileInformationDescriptor = (descriptor: FileDescriptor) => Promise<FileDescriptor>;


declare type HttpRequestOptionsBuilder = (requestOptions: http.RequestOptions, taskId: string, index: number, from: number, to: number, progress: number) => http.RequestOptions;

export {
    TaskIdGenerator, FileInformationDescriptor, HttpRequestOptionsBuilder
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
    // 是否支持断点续传
    resume: boolean;
    md5: string;
    createTime: number;
    attachment?: any;
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


const md5DownloadUrlTaskIdGenerator: TaskIdGenerator = async (downloadUrl: string, storageDir: string, filename?: string) => {
    return crypto.createHash('md5').update(downloadUrl).digest('hex');
};

export {
    md5DownloadUrlTaskIdGenerator
}

export {
    Logger,
    ConsoleLogger,
    LoggerInterface,
    CommonUtils,
    DownloadTaskGroup,
    DownloadTask,
    DownloadWorker,
    requestMethodHeadFileInformationDescriptor
}