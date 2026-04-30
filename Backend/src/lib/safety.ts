// Patterns that should block execution unless explicitly confirmed.
const DANGEROUS_PATTERNS: { regex: RegExp; reason: string }[] = [
    { regex: /\brm\s+-rf?\s+\/(?!\S)/i, reason: 'Recursive deletion of root filesystem' },
    { regex: /\brm\s+-rf?\s+(\/\*|\/etc|\/usr|\/var|\/home|\/root)/i, reason: 'Recursive deletion of system path' },
    { regex: /\brm\s+-rf\b/i, reason: 'Recursive force-delete (rm -rf)' },
    { regex: /\bshutdown\b/i, reason: 'System shutdown' },
    { regex: /\breboot\b/i, reason: 'System reboot' },
    { regex: /\bhalt\b/i, reason: 'System halt' },
    { regex: /\bpoweroff\b/i, reason: 'System power-off' },
    { regex: /\bmkfs(\.|\s)/i, reason: 'Filesystem creation (mkfs)' },
    { regex: /\bdd\s+if=.*of=\/dev\//i, reason: 'Disk overwrite via dd' },
    { regex: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'Fork bomb' },
    { regex: /\bchmod\s+-R\s+777\s+\//i, reason: 'World-writable on root paths' },
    { regex: /\bchown\s+-R\s+.*\s+\//i, reason: 'Recursive ownership change on root' },
    { regex: />\s*\/dev\/sd[a-z]/i, reason: 'Direct write to a raw disk device' },
];

export interface SafetyResult {
    safe: boolean;
    reason?: string;
}

export function checkSafety(command: string): SafetyResult {
    const cmd = (command || '').trim();
    if (!cmd) return { safe: true };
    for (const { regex, reason } of DANGEROUS_PATTERNS) {
        if (regex.test(cmd)) return { safe: false, reason };
    }
    return { safe: true };
}

export const COMMAND_SUGGESTIONS = [
    { cmd: 'ls', desc: 'List directory contents' },
    { cmd: 'pwd', desc: 'Show current directory path' },
    { cmd: 'cd', desc: 'Change directory' },
    { cmd: 'locate', desc: 'Search files by name' },
    { cmd: 'find', desc: 'Search files and directories' },
    { cmd: 'mkdir', desc: 'Create a directory' },
    { cmd: 'rmdir', desc: 'Remove an empty directory' },
    { cmd: 'rm', desc: 'Delete files or directories' },
    { cmd: 'cp', desc: 'Copy files or directories' },
    { cmd: 'mv', desc: 'Move or rename files' },
    { cmd: 'touch', desc: 'Create an empty file' },
    { cmd: 'file', desc: 'Show file type' },
    { cmd: 'zip', desc: 'Compress files into ZIP archive' },
    { cmd: 'unzip', desc: 'Extract ZIP archive' },
    { cmd: 'tar', desc: 'Archive files and directories' },
    { cmd: 'nano', desc: 'Edit files with Nano' },
    { cmd: 'vi', desc: 'Edit files with Vi' },
    { cmd: 'cat', desc: 'Display file content' },
    { cmd: 'grep', desc: 'Search text patterns in files' },
    { cmd: 'sed', desc: 'Replace or modify text patterns' },
    { cmd: 'head', desc: 'Show first lines of a file' },
    { cmd: 'tail', desc: 'Show last lines of a file' },
    { cmd: 'awk', desc: 'Process and analyze text' },
    { cmd: 'sort', desc: 'Sort file content' },
    { cmd: 'cut', desc: 'Extract sections of text' },
    { cmd: 'diff', desc: 'Compare two files' },
    { cmd: 'tee', desc: 'Output to terminal and file' },
    { cmd: 'sudo', desc: 'Run command as administrator' },
    { cmd: 'whoami', desc: 'Show current user' },
    { cmd: 'chmod', desc: 'Change file permissions' },
    { cmd: 'chown', desc: 'Change file ownership' },
    { cmd: 'df', desc: 'Show disk space usage' },
    { cmd: 'du', desc: 'Show directory size' },
    { cmd: 'top', desc: 'Display running processes' },
    { cmd: 'htop', desc: 'Interactive process viewer' },
    { cmd: 'ps', desc: 'Show process snapshot' },
    { cmd: 'uname', desc: 'Show system information' },
    { cmd: 'hostname', desc: 'Show or set hostname' },
    { cmd: 'systemctl', desc: 'Manage system services' },
    { cmd: 'jobs', desc: 'List shell background jobs' },
    { cmd: 'kill', desc: 'Terminate a process' },
    { cmd: 'ping', desc: 'Test network connectivity' },
    { cmd: 'wget', desc: 'Download files from the web' },
    { cmd: 'curl', desc: 'Transfer data via URL' },
    { cmd: 'scp', desc: 'Copy files over SSH' },
    { cmd: 'rsync', desc: 'Sync files between systems' },
    { cmd: 'ip', desc: 'Manage network settings' },
    { cmd: 'netstat', desc: 'Show network connections' },
    { cmd: 'traceroute', desc: 'Trace network packet path' },
    { cmd: 'nslookup', desc: 'Query DNS records' },
    { cmd: 'dig', desc: 'Detailed DNS lookup' },
    { cmd: 'history', desc: 'Show command history' },
    { cmd: 'man', desc: 'Show command manual' },
    { cmd: 'echo', desc: 'Print text to terminal' },
    { cmd: 'ln', desc: 'Create file links' },
    { cmd: 'cal', desc: 'Display calendar' },
    { cmd: 'apt', desc: 'Manage packages (Debian-based)' },
    { cmd: 'dnf', desc: 'Manage packages (RHEL-based)' },
];
