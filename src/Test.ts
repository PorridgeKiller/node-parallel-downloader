/**
 * Description:
 * Author: SiFan Wei - porridge
 * Date: 2020-05-24 21:22
 */

import DownloadManager from './DownloadManager';
import {DownloadEvent} from './Config';
import Logger from './Logger';

async function test() {

    const manager = new DownloadManager();

    const task = await manager.newTask(
        'https://a24.gdl.netease.com/2003011457_12162019_GG_NetVios_190535.zip',
        'temp_repo',
        'GG_NetVios.zip',
        20
    );
    Logger.debug(`[VUE]taskId: ${task.getTaskId()}`);
    task.on(DownloadEvent.STARTED, () => {
        Logger.debug('+++DownloadEvent.STARTED:');
    }).on(DownloadEvent.PROGRESS, (progress) => {
        Logger.debug('+++DownloadEvent.PROGRESS:', progress);
    }).on(DownloadEvent.FINISHED, (descriptor) => {
        Logger.debug('+++DownloadEvent.FINISHED:', descriptor);
    }).on(DownloadEvent.ERROR, (errorMessage) => {
        Logger.debug('+++DownloadEvent.ERROR:', errorMessage);
    });
    manager.start(task.getTaskId());
}

test();