import { useState } from 'react';
import { Box, Paper, Typography, TextField, Button, Tabs, Tab, Alert, Stack } from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ModeToggle } from '../App.jsx';
import Logo from '../components/Logo.jsx';

export default function LoginPage() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setUser(await api.post(mode === 0 ? '/api/auth/login' : '/api/auth/register', { username, password }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: 12, right: 12 }}>
        <ModeToggle />
      </Box>
      <Paper sx={{ p: 4, width: '100%', maxWidth: 400 }}>
        <Stack alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <Logo size={64} />
          <Typography variant="h5" fontWeight={700}>Luca's SAT</Typography>
        </Stack>
        <Tabs value={mode} onChange={(e, v) => setMode(v)} variant="fullWidth" sx={{ mb: 2 }}>
          <Tab label="Sign in" />
          <Tab label="Create account" />
        </Tabs>
        <Box component="form" onSubmit={submit}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus fullWidth />
            <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth />
            <Button type="submit" variant="contained" size="large" disabled={busy || !username} startIcon={mode === 0 ? <LoginIcon /> : <PersonAddIcon />}>
              {mode === 0 ? 'Sign in' : 'Create account'}
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}
