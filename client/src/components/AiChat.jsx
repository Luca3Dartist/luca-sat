import { useEffect, useRef, useState } from 'react';
import { Paper, Stack, Typography, TextField, IconButton, Box, CircularProgress, Alert, Avatar, Button } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import MrAiIcon from '@mui/icons-material/SentimentSatisfiedAlt';
import PersonIcon from '@mui/icons-material/Person';
import { api } from '../api.js';
import Markdown from './Markdown.jsx';
import LightbulbIcon from '@mui/icons-material/Lightbulb';

export default function AiChat({ testId, questionId, autoStart = false }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(false);
  const endRef = useRef(null);

  const send = async (history) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/api/ai/chat', { testId, questionId, messages: history });
      setMessages([...history, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setMessages([]);
    started.current = false;
  }, [questionId]);

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      send([]);
    }
  }, [questionId, autoStart]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);

  const submit = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    send(next);
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <MrAiIcon color="secondary" />
        <Typography fontWeight={700}>Ask Mr AI about this question</Typography>
      </Stack>
      <Stack spacing={1.5} sx={{ maxHeight: 380, overflowY: 'auto', mb: 1.5, pr: 1 }}>
        {messages.map((m, i) => (
          <Stack key={i} direction="row" spacing={1} alignItems="flex-start" justifyContent={m.role === 'user' ? 'flex-end' : 'flex-start'}>
            {m.role === 'assistant' && (
              <Avatar sx={{ width: 28, height: 28, bgcolor: 'secondary.main' }}>
                <MrAiIcon sx={{ fontSize: 18 }} />
              </Avatar>
            )}
            <Paper sx={{ p: 1.5, maxWidth: '85%', bgcolor: (t) => (m.role === 'user' ? t.palette.primary.main : t.frost?.backgroundColor || t.palette.background.paper), backdropFilter: (t) => (m.role === 'user' ? 'none' : t.frost?.backdropFilter || 'none'), color: m.role === 'user' ? '#fff' : 'text.primary' }}>
              {m.role === 'assistant' ? <Markdown text={m.content} /> : <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{m.content}</Typography>}
            </Paper>
            {m.role === 'user' && (
              <Avatar sx={{ width: 28, height: 28, bgcolor: 'primary.main' }}>
                <PersonIcon sx={{ fontSize: 18 }} />
              </Avatar>
            )}
          </Stack>
        ))}
        {busy && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
            <CircularProgress size={16} />
            <Typography variant="body2">Mr AI is thinking...</Typography>
          </Stack>
        )}
        {!messages.length && !busy && (
          <Box>
            <Button size="small" variant="outlined" color="secondary" startIcon={<LightbulbIcon />} onClick={() => send([])}>Explain this question</Button>
          </Box>
        )}
        <Box ref={endRef} />
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      <Box component="form" onSubmit={submit}>
        <Stack direction="row" spacing={1}>
          <TextField size="small" fullWidth placeholder="Type a question, like: why is B wrong?" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
          <IconButton type="submit" color="primary" disabled={busy || !input.trim()}>
            <SendIcon />
          </IconButton>
        </Stack>
      </Box>
    </Paper>
  );
}
