/**
 * Description:
 * Author: SiFan Wei - porridge
 * Date: 2020-05-31 23:07
 */

export default interface LoggerInterface {

    debug(message?: any, ...args: any[]): void;

    info(message?: any, ...args: any[]): void;

    warn(message?: any, ...args: any[]): void;

    error(message?: any, ...args: any[]): void;

    printStackTrace(): void;

    assert(condition: boolean, ...errorArgs: any[]): void;

    disabled(): boolean;

    setDisabled(disabled: boolean): void;

    setProxy(logger: LoggerInterface): void;
}