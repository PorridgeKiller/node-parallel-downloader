/**
 * Description:
 * Author: SiFan Wei - porridge
 * Date: 2020-05-31 23:07
 */

export default interface LoggerInterface {

    debug(...args: any[]): void;

    info(...args: any[]): void;

    warn(...args: any[]): void;

    error( ...args: any[]): void;

    printStackTrace(...args: any[]): void;

    assert(condition: boolean, ...errorArgs: any[]): void;

    disabled(): boolean;

    setDisabled(disabled: boolean): void;

    setProxy(logger: LoggerInterface): void;
}