import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  Container,
  TextField,
  Button,
  Paper,
  Alert,
} from '@mui/material';

/**
 * N-ABLE official logo mark:
 *  - Bold geometric "N" in white with a purple square accent on top-right
 *  - "N-ABLE" wordmark in white bold caps
 */
const NableLogo: React.FC = () => (
  <svg width="148" height="36" viewBox="0 0 148 36" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="N-ABLE">
    {/* ── N lettermark ── */}
    {/* Left vertical bar */}
    <rect x="0" y="4" width="7" height="28" rx="1" fill="#FFFFFF" />
    {/* Right vertical bar */}
    <rect x="19" y="4" width="7" height="28" rx="1" fill="#FFFFFF" />
    {/* Diagonal stroke (N crossbar) */}
    <polygon points="0,4 7,4 26,32 19,32" fill="#FFFFFF" />
    {/* Purple accent square — top-right of the N */}
    <rect x="16" y="4" width="10" height="10" rx="1" fill="#9B59FF" />

    {/* ── N-ABLE wordmark ── */}
    <text
      x="38"
      y="26"
      fontFamily="Inter,Arial Black,Arial,sans-serif"
      fontWeight="900"
      fontSize="19"
      fill="#FFFFFF"
      letterSpacing="1.5"
    >
      N-ABLE
    </text>
  </svg>
);

const Login: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = () => {
    if (username === 'admin' && password === 'admin') {
      onLogin();
    } else {
      setError('Invalid username or password');
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#ECEAF6' }}>
      {/* ── Top bar — matches N-tranet dark nav ── */}
      <AppBar
        position="static"
        elevation={0}
        sx={{
          bgcolor: '#1A1A2E',
          borderBottom: '4px solid #7C3AED',
        }}
      >
        <Toolbar sx={{ gap: 2, minHeight: 56 }}>
          <NableLogo />

          <Box sx={{ width: '1px', height: 28, bgcolor: 'rgba(255,255,255,0.15)' }} />

          <Typography
            variant="subtitle1"
            sx={{ color: 'rgba(255,255,255,0.80)', fontWeight: 500, flexGrow: 1, letterSpacing: '0.02em' }}
          >
            NCIP Manager
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
          <Typography variant="h4" component="h1" gutterBottom align="center" sx={{ mb: 3, fontWeight: 600 }}>
            Sign In
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <TextField
            fullWidth
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            margin="normal"
            variant="outlined"
          />

          <TextField
            fullWidth
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            margin="normal"
            variant="outlined"
          />

          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={handleLogin}
            sx={{
              mt: 3,
              bgcolor: '#7C3AED',
              '&:hover': { bgcolor: '#5B2D91' },
              fontWeight: 600,
            }}
          >
            Sign In
          </Button>
        </Paper>
      </Container>
    </Box>
  );
};

export default Login;