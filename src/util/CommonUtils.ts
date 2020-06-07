/**
 * Description:
 * Author: SiFan Wei - porridge
 * Date: 2020-06-07 01:08
 */
import {Config} from '../Config';
import * as FileOperator from './FileOperator'

export function getSimpleTaskId(taskId: string) {
    if (taskId.length > 4) {
        // 只保留4位
        return taskId.substring(taskId.length - 4);
    }
    // 只保留4位
    return taskId;
}



export function getChunkFilename(taskId: string, index: number) {
    if (index === 0) {
        return taskId + '_chunk_' + index + Config.BLOCK_FILENAME_EXTENSION
    }
    return 'chunk_' + index + Config.BLOCK_FILENAME_EXTENSION;
}


export function getChunkFileDirectory(taskId: string, storageDirectory: string, index: number) {
    if (index === 0) {
        return storageDirectory;
    }
    return FileOperator.pathJoin(storageDirectory, taskId);
}


export function getChunkFilePath(taskId: string, storageDirectory: string, index: number) {
    return FileOperator.pathJoin(getChunkFileDirectory(taskId, storageDirectory, index), getChunkFilename(taskId, index));
}

