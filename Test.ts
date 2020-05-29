/**
 * Description:
 * Author: SiFan Wei - porridge
 * Date: 2020-05-24 21:22
 */

import DownloadManager from './src/DownloadManager';
import {DownloadEvent, FileDescriptor} from './src/Config';
import Logger from './src/util/Logger';
import * as crypto from 'crypto';

async function test() {


    // const writeStream = fs.createWriteStream('temp', {
    //     flags: 'a'
    // });
    //
    // for (let i = 0; i < 10; i++) {
    //     writeStream.write('text' + i + '\n');
    // }
    // writeStream.close();

    const manager = new DownloadManager()
        .configConfigDir('temp_info')
        .configProgressTicktockMillis(500);
    // manager.configFileInfoDescriptor(async (descriptor: FileDescriptor) => {
    //
    //
    //     descriptor.contentType = 'application/zip';
    //     descriptor.contentLength = (35623715);
    //     const md5 = crypto.createHash('md5');
    //     descriptor.md5 = md5.update(descriptor.downloadUrl).digest('hex');
    //     return descriptor;
    // });
    await manager.loadInfoFiles();
    const task = await manager.newTask(
        'https://a24.gdl.netease.com/2003011457_12162019_GG_NetVios_190535.zip',
        'temp_repo',
        'GG_NetVios.zip',
        50
    );

    // const task = await manager.newTask(
    //     'https://a24.gdl.netease.com/1926111511_electronuts.zip',
    //     'temp_repo',
    //     '1926111511.zip',
    //     5
    // );

    Logger.debug(`[User]taskId: ${task.getTaskId()}`);
    task.on(DownloadEvent.STARTED, () => {
        Logger.debug('+++DownloadEvent.STARTED:');
    }).on(DownloadEvent.PROGRESS, (progress) => {
        Logger.debug('+++DownloadEvent.PROGRESS:', Math.round((progress.progress / progress.contentLength) * 10000) / 100 + '%', progress);
    }).on(DownloadEvent.FINISHED, (descriptor) => {
        Logger.debug('+++DownloadEvent.FINISHED:', descriptor);
    }).on(DownloadEvent.ERROR, (errorMessage) => {
        Logger.debug('+++DownloadEvent.ERROR:', errorMessage);
    });
    manager.start(task.getTaskId());
    // setTimeout(() => {
    //     task.cancel();
    //     Logger.debug('status:', task.getStatus());
    // }, 9000);
}

test();