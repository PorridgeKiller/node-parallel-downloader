/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-18 17:37
 */
import { EventEmitter } from 'events';
import Logger from './util/Logger';
import DownloadManager from './DownloadManager';
import DownloadTask from './DownloadTask';
import DownloadWorker from './DownloadWorker';
export declare const Config: {
    INFO_FILE_EXTENSION: string;
    BLOCK_FILENAME_EXTENSION: string;
};
export declare enum DownloadStatus {
    STOP = "STOP",
    INIT = "INIT",
    FINISHED = "FINISHED",
    DOWNLOADING = "DOWNLOADING",
    CANCEL = "CANCEL",
    ERROR = "ERROR",
    MERGE = "MERGE"
}
export declare enum DownloadEvent {
    ERROR = "ERROR",
    STARTED = "STARTED",
    STOP = "STOP",
    FINISHED = "FINISHED",
    CANCELED = "CANCELED",
    PROGRESS = "PROGRESS",
    MERGE = "MERGE"
}
export declare class ErrorMessage {
    code: string;
    message: string;
    taskId?: string;
    error: NodeJS.ErrnoException;
    constructor(code: string, message: string, error: NodeJS.ErrnoException);
    static fromCustomer(code: string, message: string, error: NodeJS.ErrnoException): ErrorMessage;
    static fromErrorEnum(errEnum: DownloadErrorEnum, error: NodeJS.ErrnoException): ErrorMessage;
}
export declare enum DownloadErrorEnum {
    DESCRIBE_FILE_ERROR = "1000@error occurred when fetching file description",
    REQUEST_TIMEOUT = "1001@request timeout",
    UNKNOWN_PROTOCOL = "1002@unknown protocol",
    SERVER_UNAVAILABLE = "1003@server unavailable",
    CREATE_DOWNLOAD_DIR_ERROR = "1004@failed to create download directory",
    READ_CHUNK_FILE_ERROR = "1005@failed to read chunk file",
    WRITE_CHUNK_FILE_ERROR = "1006@failed to write into chunk file",
    APPEND_TARGET_FILE_ERROR = "1007@failed to append target file"
}
declare type TaskIdGenerator = (downloadUrl: string, storageDir: string, filename: string) => Promise<string>;
declare type FileInformationDescriptor = (descriptor: FileDescriptor) => Promise<FileDescriptor>;
export { TaskIdGenerator, FileInformationDescriptor };
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
    };
}
export interface ChunkInfo {
    index: number;
    length: number;
    from: number;
    to: number;
}
declare const defaultFileInformationDescriptor: FileInformationDescriptor;
declare const defaultTaskIdGenerator: TaskIdGenerator;
export { defaultFileInformationDescriptor, defaultTaskIdGenerator };
/**
 * 下载状态管理器
 * DownloadTask extends DownloadStatusHolder
 * DownloadWorker extends DownloadStatusHolder
 */
export declare class DownloadStatusHolder extends EventEmitter {
    private status;
    protected setStatus(nextStatus: DownloadStatus): boolean;
    getStatus(): DownloadStatus;
    /**
     * CAS: 保证状态不被重复设置, 返回的boolean值用来保证各种事件只发送一次, 并且状态转换逻辑只执行一次
     *
     * false: 代表要更新的状态和之前的状态一样, 表明重复多余设置
     * true:  可以用来控制ERROR等回调只执行一次, 因为下载write操作很频繁, 不加控制会回调上百次
     *
     * @param nextStatus 要设置的状态
     * @param reentrant 是否可重入, 默认不可重入
     */
    protected compareAndSwapStatus(nextStatus: DownloadStatus, reentrant?: boolean): boolean;
}
export { Logger, DownloadManager, DownloadTask, DownloadWorker, };
