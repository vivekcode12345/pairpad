import axios from 'axios';
import { WANDBOX_COMPILERS } from '../config/constants.js';

// Wandbox is a shared public service, so infrastructure failures are not code errors.
const INFRASTRUCTURE_ERROR = /(OCI runtime error|Resource temporarily unavailable|Cannot connect to the Docker|containerd|docker daemon|spawn .* failed)/i;

export async function runOnWandbox(language, code, stdin = '') {
    const compiler = WANDBOX_COMPILERS[language];
    if (!compiler) throw new Error(`Language '${language}' not supported`);
    const { data } = await axios.post('https://wandbox.org/api/compile.json', {
        compiler,
        code,
        stdin: String(stdin).slice(0, 5000),
        save: false,
    }, { timeout: 60000 });
    if (!data.program_output && data.compiler_error) {
        return String(data.compiler_error).slice(0, 5000);
    }
    const output = data.program_output || data.program_message
        || data.compiler_output || data.compiler_message
        || '(no output)';
    return String(output).slice(0, 5000);
}

export async function compileWithWandbox(language, code, stdin, timeoutMs) {
    const compiler = WANDBOX_COMPILERS[language];
    if (!compiler) {
        return {
            compilerError: '', programOutput: '', programMessage: '',
            status: -1, timeOut: false, internalError: `Language '${language}' not supported`, ms: 0,
        };
    }
    const start = Date.now();
    try {
        const { data } = await axios.post('https://wandbox.org/api/compile.json', {
            compiler,
            code,
            stdin: String(stdin).slice(0, 5000),
            save: false,
        }, { timeout: timeoutMs });
        const compilerError = data.compiler_error || '';
        const programMessage = data.program_message || '';
        const infrastructureFailure = INFRASTRUCTURE_ERROR.test(compilerError)
            || INFRASTRUCTURE_ERROR.test(programMessage)
            || String(data.status) === '126';
        return {
            compilerError: infrastructureFailure ? '' : compilerError,
            programOutput: data.program_output || '',
            programMessage,
            status: data.status,
            timeOut: !!data.time_out,
            internalError: infrastructureFailure
                ? String(compilerError || programMessage || 'Wandbox container failed to start').slice(0, 5000)
                : '',
            ms: Date.now() - start,
        };
    } catch (error) {
        const timedOut = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT';
        return {
            compilerError: '',
            programOutput: '',
            programMessage: '',
            status: -1,
            timeOut: timedOut,
            internalError: timedOut ? '' : `Wandbox request failed: ${error?.message || 'network error'}`,
            ms: Date.now() - start,
        };
    }
}
