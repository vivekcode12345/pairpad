import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'typescript' || label === 'javascript') {
      return new TsWorker();
    }
    return new EditorWorker();
  },
};

loader.config({ monaco });

monaco.editor.defineTheme('cc-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editorGutter.background': '#ffffff',
    'editor.selectionBackground': '#d59a2a33',
    'editor.lineHighlightBackground': '#f7f7f4',
    'editorCursor.foreground': '#b87516',
  },
});