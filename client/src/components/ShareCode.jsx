import { useState } from 'react';
import { Chip, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';

export default function ShareCode({ code, size = 'small' }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Tooltip title={copied ? 'Copied' : 'Share this code so others can take the same test'}>
      <Chip
        size={size}
        variant="outlined"
        color="secondary"
        icon={copied ? <CheckIcon /> : <ContentCopyIcon />}
        label={`Code ${code}`}
        onClick={copy}
        sx={{ fontWeight: 700, letterSpacing: 1 }}
      />
    </Tooltip>
  );
}
