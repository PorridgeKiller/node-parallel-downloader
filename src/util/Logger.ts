/**
 * Description:
 * Author: SiFan Wei - porridge
 * Date: 2020-05-24 21:51
 */

export default class Logger {


    static debug(message?: any, ...args: any[]): void {
        console.debug('[debug]', message, ...args);
    };

    static info(message?: any, ...args: any[]): void {
        console.info('[info]', message, ...args);
    };

    static warn(message?: any, ...args: any[]): void {
        console.warn('[warn]', message, ...args);
    };

    static error(message?: any, ...args: any[]): void {
        console.error('[debug]', message, ...args);
    };
}