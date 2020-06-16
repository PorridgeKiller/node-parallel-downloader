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

export function beautifyFileSize(size: number) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB', 'BB'];
    let index = 0;
    let k = size;
    if (size >= 1024) {
        while (k > 1024) {
            k = k / 1024;
            index++;
        }
    }
    return `${(k).toFixed(2)}${units[index]}`;
}

export function calculateProgress(progress: any, ticktock: number) {
    const offset = progress.progress - progress.prevProgress;
    const speed = Math.round(offset / (ticktock / 1000));
    const percent = Math.round((progress.progress / progress.length) * 10000) / 10000;
    return {
        speed,
        percent,
    }
}

export function beautifyProgress(progress: any, ticktock: number) {
    const calculated = calculateProgress(progress, ticktock);
    const result: any = {};
    if (progress.index !== undefined) {
        result.index = progress.index;
    }
    result.speed = beautifyFileSize(calculated.speed) + '/s';
    result.percent = (calculated.percent * 100).toFixed(2) + '%';
    result.progress = beautifyFileSize(progress.progress);
    return result;
}

export function beautifyProgressWithChunks(progress: any, ticktock: number) {
    const beautifiedProgress = beautifyProgress(progress, ticktock);
    const chunks: any[] = [];
    progress.chunks.forEach((chunkProgress: any) => {
        const beautifiedChunk = beautifyProgress(chunkProgress, ticktock);
        beautifiedChunk.noResp = chunkProgress.noResp;
        beautifiedChunk.retry = chunkProgress.retry;
        chunks.push(beautifiedChunk);
    });
    beautifiedProgress.chunks = chunks;
    return beautifiedProgress;
}