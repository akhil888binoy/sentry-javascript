import type { StackFrame } from '@sentry/types';

import { applySourceContextToFrame } from '../src/contextlines';

const lines = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8', 'line9'];
describe('ContextLines', () => {
  describe('applySourceContextToFrame', () => {
    it.each([
      [
        5,
        {
          pre_context: ['line2', 'line3', 'line4'],
          context_line: 'line5',
          post_context: ['line6', 'line7', 'line8'],
        },
      ],
      [
        1,
        {
          context_line: 'line1',
          post_context: ['line2', 'line3', 'line4'],
        },
      ],
      [
        2,
        {
          pre_context: ['line1'],
          context_line: 'line2',
          post_context: ['line3', 'line4', 'line5'],
        },
      ],
      [
        9,
        {
          pre_context: ['line6', 'line7', 'line8'],
          context_line: 'line9',
        },
      ],
      [
        11,
        {
          pre_context: ['line8', 'line9'],
        },
      ],
    ])(
      'correctly applies pre, post contexts and context lines for an inline stack frame (lineno %s)',
      (lineno, contextLines) => {
        const frame: StackFrame = {
          lineno,
          filename: 'https://mydomain.com/index.html',
        };

        expect(applySourceContextToFrame(frame, lines, 'https://mydomain.com/index.html', 7)).toStrictEqual({
          filename: 'https://mydomain.com/index.html',
          lineno,
          ...contextLines,
        });
      },
    );

    it('only applies the context line if the range is 1', () => {
      const frame: StackFrame = {
        lineno: 5,
        filename: 'https://mydomain.com/index.html',
      };

      expect(applySourceContextToFrame(frame, lines, 'https://mydomain.com/index.html', 1)).toStrictEqual({
        filename: 'https://mydomain.com/index.html',
        lineno: 5,
        context_line: 'line5',
      });
    });

    it("no-ops if the frame's line number is out of bounds for the found lines", () => {
      const frame: StackFrame = {
        lineno: 20,
        filename: 'https://mydomain.com/index.html',
      };

      expect(applySourceContextToFrame(frame, lines, 'https://mydomain.com/index.html', 7)).toStrictEqual(frame);
    });

    it("no-ops if the frame's filename is not the html file's name", () => {
      const frame: StackFrame = {
        filename: '/someScript.js',
      };

      expect(applySourceContextToFrame(frame, lines, 'https://mydomain.com/index.html', 7)).toStrictEqual(frame);
    });

    it("no-ops if the frame doesn't have a line number", () => {
      const frame: StackFrame = {
        filename: '/index.html',
      };

      expect(applySourceContextToFrame(frame, lines, 'https://mydomain.com/index.html', 0)).toStrictEqual(frame);
    });

    it("no-ops if the frame doesn't have a filename", () => {
      const frame: StackFrame = {
        lineno: 9,
      };

      expect(applySourceContextToFrame(frame, lines, 'https://mydomain.com/index.html', 0)).toStrictEqual(frame);
    });

    it('no-ops if there are no html lines available', () => {
      const frame: StackFrame = {
        lineno: 9,
        filename: '/index.html',
      };
      expect(applySourceContextToFrame(frame, [], 'https://mydomain.com/index.html', 0)).toStrictEqual(frame);
    });
  });
});
