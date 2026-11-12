import { useState } from 'react';
import { Stack, Typography, Paper, TextField, Button, Alert, Switch, FormControlLabel, Box, Chip, LinearProgress } from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import WallpaperIcon from '@mui/icons-material/Wallpaper';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LockResetIcon from '@mui/icons-material/LockReset';
import KeyIcon from '@mui/icons-material/Key';
import SaveIcon from '@mui/icons-material/Save';
import BlockIcon from '@mui/icons-material/Block';
import MrAiIcon from '@mui/icons-material/SentimentSatisfiedAlt';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useColorMode } from '../colorMode.js';

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const [key, setKey] = useState('');
  const [keyMsg, setKeyMsg] = useState(null);
  const { mode, toggle, glass, setGlass } = useColorMode();
  const [bgBusy, setBgBusy] = useState(false);
  const [bgMsg, setBgMsg] = useState(null);

  const uploadBg = async (file) => {
    if (!file) return;
    setBgBusy(true);
    setBgMsg(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      setUser(await api.form('/api/me/background', fd));
    } catch (e) {
      setBgMsg(e.message);
    } finally {
      setBgBusy(false);
    }
  };

  const changePassword = async () => {
    try {
      await api.put('/api/me/password', { current, next });
      setPwMsg({ type: 'success', text: 'Password changed' });
      setCurrent('');
      setNext('');
    } catch (e) {
      setPwMsg({ type: 'error', text: e.message });
    }
  };

  const saveKey = async (value) => {
    try {
      setUser(await api.put('/api/me/settings', { apiKey: value }));
      setKey('');
      setKeyMsg({ type: 'success', text: value ? 'Saved' : 'Removed, the default key will be used' });
    } catch (e) {
      setKeyMsg({ type: 'error', text: e.message });
    }
  };

  const setHate = async (v) => setUser(await api.put('/api/me/settings', { hateAi: v }));

  const aiLabel = user.ai?.enabled ? `Mr AI is on, using ${user.ai.via === 'word' ? 'an access word' : user.ai.via === 'personal' ? 'your own key' : 'the default key'} (${user.ai.model})` : user.hateAi ? 'Mr AI is turned off' : 'Mr AI is not available until an admin sets a default key or you add your own';

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Typography variant="h4" fontWeight={700}>Settings</Typography>

      <Paper sx={{ p: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <PaletteIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>Appearance</Typography>
        </Stack>
        <Stack>
          <FormControlLabel control={<Switch checked={mode === 'dark'} onChange={toggle} />} label="Dark mode" />
          <FormControlLabel control={<Switch checked={glass} onChange={(e) => setGlass(e.target.checked)} />} label="Liquid glass interface" />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          Liquid glass bends and blurs your background behind every card. It looks best with a background picture.
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box
            sx={{
              width: 160,
              height: 90,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
              backgroundImage: user.background ? `url("${user.background}")` : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'grid',
              placeItems: 'center',
              color: 'text.secondary',
              flexShrink: 0,
            }}
          >
            {!user.background && <WallpaperIcon />}
          </Box>
          <Stack spacing={1}>
            <Button component="label" variant="contained" startIcon={<WallpaperIcon />} disabled={bgBusy}>
              {user.background ? 'Change background' : 'Upload background'}
              <input hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => uploadBg(e.target.files?.[0])} />
            </Button>
            {user.background && (
              <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={async () => setUser(await api.del('/api/me/background'))}>
                Remove background
              </Button>
            )}
            <Typography variant="caption" color="text.secondary">Pictures and GIFs up to 25 MB. It is cropped to fill the screen.</Typography>
          </Stack>
        </Stack>
        {bgBusy && <LinearProgress sx={{ mt: 2 }} />}
        {bgMsg && <Alert severity="error" sx={{ mt: 2 }}>{bgMsg}</Alert>}
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <BlockIcon color="error" />
          <Typography variant="h6" fontWeight={700}>I HATE AI</Typography>
        </Stack>
        <FormControlLabel control={<Switch checked={user.hateAi} onChange={(e) => setHate(e.target.checked)} color="error" />} label="Turn off Mr AI completely for my account" />
      </Paper>

      <Paper sx={{ p: 3, opacity: user.hateAi ? 0.5 : 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <MrAiIcon color="secondary" />
          <Typography variant="h6" fontWeight={700}>Mr AI key</Typography>
        </Stack>
        <Chip label={aiLabel} color={user.ai?.enabled ? 'success' : 'default'} sx={{ mb: 2, maxWidth: '100%' }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Paste your own Anthropic API key, or type an access word that an admin gave you. Leave it empty to use the default key.
        </Typography>
        {user.hasApiKey && (
          <Typography variant="body2" sx={{ mb: 2 }}>
            Current: <b>{user.apiKey}</b> {user.apiKeyIsWord ? '(access word)' : ''}
          </Typography>
        )}
        <Stack direction="row" spacing={1}>
          <TextField size="small" fullWidth label="API key or access word" value={key} onChange={(e) => setKey(e.target.value)} disabled={user.hateAi} />
          <Button variant="contained" startIcon={<SaveIcon />} onClick={() => saveKey(key.trim())} disabled={!key.trim() || user.hateAi}>Save</Button>
        </Stack>
        {user.hasApiKey && (
          <Button sx={{ mt: 1 }} size="small" color="error" onClick={() => saveKey('')} disabled={user.hateAi}>Remove and use the default</Button>
        )}
        {keyMsg && <Alert severity={keyMsg.type} sx={{ mt: 2 }}>{keyMsg.text}</Alert>}
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <KeyIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>Change password</Typography>
        </Stack>
        <Stack spacing={2}>
          <TextField type="password" label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <TextField type="password" label="New password" value={next} onChange={(e) => setNext(e.target.value)} />
          <Box>
            <Button variant="contained" startIcon={<LockResetIcon />} onClick={changePassword}>Change password</Button>
          </Box>
          {pwMsg && <Alert severity={pwMsg.type}>{pwMsg.text}</Alert>}
        </Stack>
      </Paper>
    </Stack>
  );
}
