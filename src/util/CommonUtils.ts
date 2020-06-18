/**
 * Description:
 * Author: SiFan Wei - porridge
 * Date: 2020-06-07 01:08
 */
import {Config} from '../Config';
import * as FileOperator from './FileOperator';

// @ts-ignore
Date.prototype.format = function (fmt: string) {
    const o: any = {
        'M+': this.getMonth() + 1,                 //月份
        'd+': this.getDate(),                    //日
        'H+': this.getHours(),                   //小时
        'm+': this.getMinutes(),                 //分
        's+': this.getSeconds(),                 //秒
        'q+': Math.floor((this.getMonth() + 3) / 3), //季度
        'S': this.getMilliseconds()             //毫秒
    };
    if (/(y+)/.test(fmt))
        fmt = fmt.replace(RegExp.$1, (this.getFullYear() + '').substr(4 - RegExp.$1.length));
    for (let k in o)
        if (new RegExp('(' + k + ')').test(fmt))
            fmt = fmt.replace(RegExp.$1, (RegExp.$1.length === 1) ? (o[k]) : (('00' + o[k]).substr(('' + o[k]).length)));
    return fmt;
};


export function getSimpleTaskId(taskId: string) {
    if (taskId.length > 4) {
        // 只保留4位
        return taskId.substring(taskId.length - 4);
    }
    // 只保留4位
    return taskId;
}



export function getChunkFilename(taskId: string, index: number, time: string) {
    if (index === 0) {
        return taskId + '_chunk_'  + time + '_' + index + Config.BLOCK_FILENAME_EXTENSION
    }
    return 'chunk_' + time + '_' + index + Config.BLOCK_FILENAME_EXTENSION;
}


export function getChunkFileDirectory(taskId: string, storageDirectory: string, index: number, time: string) {
    if (index === 0) {
        return storageDirectory;
    }
    return FileOperator.pathJoin(storageDirectory, `${taskId}-${time}`);
}


export function getChunkFilePath(taskId: string, storageDirectory: string, index: number, time: string) {
    return FileOperator.pathJoin(getChunkFileDirectory(taskId, storageDirectory, index, time), getChunkFilename(taskId, index, time));
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