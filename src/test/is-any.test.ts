import {test, expect} from 'vitest';
import { isAny } from '../is-any';

test('isAny', () => {
  expect(isAny('const x: any')).toBe(true);
  expect(isAny('(method) JSON.parse(text: string, reviver?: (this: any, key: string, value: any) => any): any')).toBe(false);
  expect(isAny('function foo(): any')).toBe(false);
  expect(isAny('(parameter) capture: any')).toBe(true);
  expect(isAny('(parameter) substr: string')).toBe(false);
  expect(isAny('(property) x: any')).toBe(true);
  expect(isAny('any')).toBe(true);

  expect(isAny('type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any')).toBe(false);
});
