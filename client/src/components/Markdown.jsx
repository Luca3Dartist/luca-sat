import { Box } from '@mui/material';

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Bold, italic and code inside one line. Runs on already-escaped text.
function inline(s) {
  return s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, '<b>$1</b>')
    .replace(/__(?=\S)([^_\n]+?)(?<=\S)__/g, '<b>$1</b>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g, '$1<i>$2</i>')
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?!\w)/g, '$1<i>$2</i>');
}

// A small, safe Markdown reader for Mr AI's replies: paragraphs, headings, lists, bold, italic, code.
export function markdownToHtml(text) {
  const lines = escapeHtml(String(text || '').replace(/\r/g, '')).split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (bullet || numbered) {
      flushPara();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((bullet || numbered)[1]);
    } else if (heading) {
      flushPara();
      flushList();
      out.push(`<p><b>${inline(heading[1])}</b></p>`);
    } else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join('');
}

export default function Markdown({ text, sx, variant = 'body2' }) {
  return (
    <Box
      sx={{
        typography: variant,
        wordBreak: 'break-word',
        '& p': { m: 0 },
        '& p + p, & p + ul, & p + ol, & ul + p, & ol + p': { mt: 1 },
        '& ul, & ol': { m: 0, pl: 2.5 },
        '& li + li': { mt: 0.5 },
        '& code': { fontFamily: 'monospace', fontSize: '0.9em', px: 0.5, borderRadius: 0.5, bgcolor: 'action.selected' },
        ...sx,
      }}
      dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }}
    />
  );
}
