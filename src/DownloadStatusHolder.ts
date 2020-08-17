/**
 * Description:
 * Author: SiFan Wei - porridge
 * Date: 2020-05-31 17:48
 */


import {DownloadStatus, DownloadEvent} from './Config';
import {EventEmitter} from 'events';

/**
 * 下载状态管理器
 * DownloadTask extends DownloadStatusHolder
 * DownloadWorker extends DownloadStatusHolder
 */
export default class DownloadStatusHolder extends EventEmitter {
    private status!: DownloadStatus;

    protected setStatus(nextStatus: DownloadStatus) {
        this.status = nextStatus;
        return true;
    }

    public getStatus(): DownloadStatus {
        return this.status;
    }

    /**
     * CAS: 保证状态不被重复设置, 返回的boolean值用来保证各种事件只发送一次, 并且状态转换逻辑只执行一次
     *
     * false: 代表要更新的状态和之前的状态一样, 表明重复多余设置
     * true:  可以用来控制ERROR等回调只执行一次, 因为下载write操作很频繁, 不加控制会回调上百次
     *
     * @param nextStatus 要设置的状态
     * @param reentrant 是否可重入, 默认不可重入
     * @param force 是否强制设置
     */
    protected compareAndSwapStatus(nextStatus: DownloadStatus, reentrant?: boolean, force?: boolean): boolean {
        const prevStatus = this.getStatus();
        if (force) {
            return this.setStatus(nextStatus);
        }
        // 第一次判断: 前后状态是否一样, 一样就直接返回false表示状态不可重复设置
        if (prevStatus === nextStatus) {
            return !!reentrant;
        }
        if (!prevStatus) {
            if (nextStatus === DownloadStatus.INIT) {
                // 状态未设置的时候, 只可以转变为DownloadStatus.INIT, 其余状态全部拒绝
                return this.setStatus(nextStatus);
            }
            return false;
        }
        // 第二次判断: 部分状态之间不可以相互转换, 下面做判断
        if (nextStatus === DownloadStatus.INIT) {
            // 任何状态都不能转为DownloadStatus.INIT
            return false;
        } else if (nextStatus === DownloadStatus.STARTED) {
            if (prevStatus === DownloadStatus.FINISHED ||
                prevStatus === DownloadStatus.MERGING ||
                prevStatus === DownloadStatus.RENAMING ||
                prevStatus === DownloadStatus.CANCELED) {
                return false;
            }
        } else if (nextStatus === DownloadStatus.DOWNLOADING) {
            if (prevStatus === DownloadStatus.ERROR ||
                prevStatus === DownloadStatus.FINISHED ||
                prevStatus === DownloadStatus.MERGING ||
                prevStatus === DownloadStatus.RENAMING ||
                prevStatus === DownloadStatus.CANCELED) {
                return false;
            }
        } else if (nextStatus === DownloadStatus.STOPPED) {
            if (prevStatus === DownloadStatus.INIT ||
                prevStatus === DownloadStatus.MERGING ||
                prevStatus === DownloadStatus.RENAMING ||
                prevStatus === DownloadStatus.FINISHED ||
                prevStatus === DownloadStatus.CANCELED ||
                prevStatus === DownloadStatus.ERROR) {
                return false;
            }
        } else if (nextStatus === DownloadStatus.MERGING) {
            if (prevStatus === DownloadStatus.RENAMING ||
                prevStatus === DownloadStatus.FINISHED ||
                prevStatus === DownloadStatus.CANCELED) {
                return false;
            }
        } else if (nextStatus === DownloadStatus.RENAMING) {
            // 只可以从MERGE/INIT状态装换过去
            if (prevStatus === DownloadStatus.STARTED ||
                prevStatus === DownloadStatus.DOWNLOADING ||
                prevStatus === DownloadStatus.STOPPED ||
                prevStatus === DownloadStatus.ERROR ||
                prevStatus === DownloadStatus.FINISHED ||
                prevStatus === DownloadStatus.CANCELED) {
                return false;
            }
        } else if (nextStatus === DownloadStatus.FINISHED) {
            if (prevStatus === DownloadStatus.ERROR ||
                // prevStatus === DownloadStatus.STOP ||
                prevStatus === DownloadStatus.CANCELED) {
                return false;
            }
        } else if (nextStatus === DownloadStatus.CANCELED) {
            // 任何状态都可以转为DownloadStatus.CANCEL
        } else if (nextStatus === DownloadStatus.ERROR) {
            if (prevStatus === DownloadStatus.STOPPED ||
                prevStatus === DownloadStatus.FINISHED ||
                prevStatus === DownloadStatus.CANCELED) {
                return false;
            }
        } else {
            // 未知的状态, 不设置
            return false;
        }
        return this.setStatus(nextStatus);
    }
}
