import { Editor } from '@monaco-editor/react';
import { Button, Select, Splitter } from './ui';
import { PlayIcon } from './Icons';

export default function RoomWorkspace({
  language,
  languages,
  onLanguageChange,
  running,
  onRun,
  editorMount,
  panelSize,
  onPanelSizeChange,
  onPanelReset,
  panel,
  onPanelChange,
  output,
  onClearOutput,
  userInput,
  onUserInputChange,
  cursorPosition,
  peopleCount,
  connection,
}) {
  return (
    <section className="cc-workspace">
      <div className="cc-editor-toolbar">
        <Select label="" className="cc-toolbar-select" value={language} onChange={onLanguageChange}>
          {languages.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
        </Select>
        <div className="cc-top-spacer" />
        <Button variant="primary" loading={running} onClick={onRun}><PlayIcon /> Run&nbsp; ⌘/Ctrl ↵</Button>
      </div>
      <div className="cc-editor">
        <Editor
          height="100%"
          language={language}
          theme="cc-light"
          options={{ minimap: { enabled: false }, fontFamily: 'var(--font-mono)', fontSize: 14, fontLigatures: true, smoothScrolling: true, cursorSmoothCaretAnimation: 'on', padding: { top: 12, bottom: 12 }, scrollBeyondLastLine: false, renderLineHighlight: 'all', bracketPairColorization: { enabled: true }, automaticLayout: true }}
          onMount={editorMount}
        />
      </div>
      <Splitter direction="horizontal" size={panelSize} onChange={onPanelSizeChange} onReset={onPanelReset} />
      <div className="cc-bottom-panel" style={{ height: `${panelSize}%` }}>
        <div className="cc-panel-tabs">
          <button className={`cc-tab ${panel === 'input' ? 'active' : ''}`} onClick={() => onPanelChange('input')}>Input</button>
          <button className={`cc-tab ${panel === 'output' ? 'active' : ''}`} onClick={() => onPanelChange('output')}>Output</button>
          <div className="cc-top-spacer" />
          {panel === 'output' && <Button size="small" variant="ghost" onClick={onClearOutput}>Clear</Button>}
        </div>
        <div className="cc-panel-content">
          {panel === 'input' ? <textarea className="cc-textarea" aria-label="Standard input" value={userInput} onChange={onUserInputChange} placeholder="Enter input for your program..." /> : output ? <pre className="cc-output">{output}</pre> : <div className="cc-empty-output">Run your code to see output here</div>}
        </div>
      </div>
      <footer className="cc-statusbar">
        <span>{language}</span>
        <span>Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}</span>
        <span className="cc-statusbar-spacer" />
        <span>{peopleCount} people</span>
        <span>{connection.label}</span>
      </footer>
    </section>
  );
}
