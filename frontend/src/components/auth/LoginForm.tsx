import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Mail, Lock, User, AlertCircle, UserCheck, ArrowRight, ArrowLeft, Eye, EyeOff, Shield } from 'lucide-react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { CustomGoogleLogin } from './CustomGoogleLogin';
import { OTPVerification } from './OTPVerification';
import { redirectToDashboard } from '../../utils/authRedirectUtils';
import { FacebookLogin } from './FacebookLogin';
import { getErrorMessage } from '../../utils/api';
import { GoogleRoleSelection } from './GoogleRoleSelection';

export function LoginForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user' as 'user' | 'agent' | 'analytics',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Google/Facebook Sign-Up State
  const [showRoleSelection, setShowRoleSelection] = useState(false);
  const [pendingGoogleToken, setPendingGoogleToken] = useState('');
  const [authSource, setAuthSource] = useState<'google' | 'facebook'>('google');
  const [googleUserInfo, setGoogleUserInfo] = useState<{ name: string, email: string } | null>(null);

  // Get auth context including OTP verification
  const { login, register, googleLogin, googleSignupWithRole, pendingVerification, cancelVerification, logout, decodeGoogleToken } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const success = isLogin
        ? await login(formData.email, formData.password)
        : await register(formData.name, formData.email, formData.password, formData.role);

      if (success) {
        redirectToDashboard();
      }
      // If success is false, it means requiresVerification is true (both login/register return false in that case)
      // The context state pendingVerification will be set, triggering a re-render to the OTP screen.
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (token: string) => {
    try {
      if (token) {
        logout();
        setError('');

        if (isLogin) {
          // LOGIN flow: try to log in with existing account
          try {
            const success = await googleLogin(token);
            if (success) {
              redirectToDashboard();
              return;
            }
          } catch (loginError: unknown) {
            // Account not found — automatically switch to signup flow
            if (loginError instanceof Error && loginError.message.includes('Account not found')) {
              const info = await decodeGoogleToken(token);
              if (info) {
                setIsLogin(false);
                setGoogleUserInfo(info);
                setPendingGoogleToken(token);
                setAuthSource('google');
                setShowRoleSelection(true);
              } else {
                setError('Failed to process Google Account details. Please try again.');
              }
            } else {
              setError(getErrorMessage(loginError));
            }
          }
        } else {
          // SIGNUP flow: go directly to role selection
          const info = await decodeGoogleToken(token);
          if (info) {
            setGoogleUserInfo(info);
            setPendingGoogleToken(token);
            setAuthSource('google');
            setShowRoleSelection(true);
          } else {
            setError('Failed to process Google Account details. Please try again.');
          }
        }
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setLoading(false);
    }
  };

  const handleRoleSelected = async (role: 'user' | 'agent' | 'analytics' | 'admin', organization?: string, phoneNumber?: string) => {
    setLoading(true);
    try {
      let success = false;
      if (authSource === 'google' && pendingGoogleToken) {
        success = await googleSignupWithRole(pendingGoogleToken, role, organization, phoneNumber);
      }

      if (success) {
        redirectToDashboard();
      } else if (!pendingVerification) {
        setError('Failed to create account with selected role.');
        setShowRoleSelection(false);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setShowRoleSelection(false);
    } finally {
      setLoading(false);
    }
  };

  const handleFacebookFailure = (error: string) => {
    setError(error);
  };

  // ----------------------------------------------------------------------
  // RENDER: Google Role Selection Overlay
  // ----------------------------------------------------------------------
  if (showRoleSelection && googleUserInfo) {
    return (
      <GoogleRoleSelection
        userInfo={googleUserInfo}
        onRoleSelected={handleRoleSelected}
        onCancel={() => setShowRoleSelection(false)}
      />
    );
  }

  // ----------------------------------------------------------------------
  // RENDER: OTP Verification
  // ----------------------------------------------------------------------
  if (pendingVerification) {
    return (
      <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''}>
      <Link to="/sso" className="fixed bottom-4 right-4 z-20 bg-white shadow border px-4 py-2 rounded-lg text-sm text-teal-800">Company SSO sign-in</Link>
        <div className="h-screen bg-white flex">
          {/* Left Side - Blue Gradient */}
          <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 to-blue-800 relative overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-20 left-20 w-32 h-32 bg-white rounded-full"></div>
              <div className="absolute bottom-32 right-20 w-24 h-24 bg-blue-300 rounded-full"></div>
              <div className="absolute top-1/2 right-1/3 w-16 h-16 bg-blue-400 rounded-full"></div>
            </div>

            <div className="relative z-10 flex flex-col justify-center px-12 py-20">
              {/* Logo */}
              <div className="flex items-center space-x-2 mb-12">
                <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-white">QuickFix</span>
              </div>

              <h1 className="text-4xl font-bold text-white mb-4">Security Verification</h1>
              <p className="text-xl text-blue-100">Please verify your identity to continue.</p>

              {/* Image */}
              <div className="mt-10 flex justify-center">
                <div className="relative">
                  <img
                    src="/login.png"
                    alt="Verification"
                    className="w-full max-w-2xl h-auto rounded-xl shadow-2xl"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-blue-600/20 to-transparent rounded-lg"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side */}
          <div className="w-full lg:w-1/2 flex flex-col justify-center relative p-8">
            <button
              onClick={cancelVerification}
              className="absolute top-8 left-8 text-gray-400 hover:text-blue-600 transition-colors flex items-center gap-2 font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <OTPVerification
              email={pendingVerification.email}
              onVerifySuccess={redirectToDashboard}
              onBack={cancelVerification}
            />
          </div>
        </div>
      </GoogleOAuthProvider>
    );
  }

  // ----------------------------------------------------------------------
  // RENDER: Main Login/Signup
  // ----------------------------------------------------------------------
  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''}>
      <Link to="/sso" className="fixed bottom-4 right-4 z-20 bg-white shadow border px-4 py-2 rounded-lg text-sm text-teal-800">Company SSO sign-in</Link>
      <div className="h-[100dvh] bg-white flex flex-col lg:flex-row overflow-x-hidden overflow-y-auto" style={{ fontFamily: '"Google Sans Flex", sans-serif' }}>

        {/* ── MOBILE ONLY: Gradient branded header ── */}
        <div className="lg:hidden w-full flex flex-col">
          {/* Top gradient banner */}
          <div className="relative bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 px-6 pt-12 pb-16 overflow-hidden">
            {/* Decorative blobs */}
            <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full blur-xl" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-400/20 rounded-full blur-lg" />

            <div className="relative z-10 flex items-center justify-between mb-8">
              {/* Logo */}
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center shadow-lg">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <span className="text-white font-bold text-lg leading-none">QuickFix</span>
                  <p className="text-blue-200 text-[10px] leading-none mt-0.5">AI Powered Support</p>
                </div>
              </div>
              {/* Back to home */}
              <Link
                to="/"
                className="flex items-center gap-1 text-blue-100 hover:text-white transition-colors text-sm font-medium bg-white/10 px-3 py-1.5 rounded-full"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Home
              </Link>
            </div>

            <div className="relative z-10">
              <h1 className="text-3xl font-bold text-white mb-1">
                {isLogin ? 'Welcome back!' : 'Create account'}
              </h1>
              <p className="text-blue-200 text-sm">
                {isLogin
                  ? 'Sign in to manage your complaints.'
                  : 'Join thousands of users on QuickFix.'}
              </p>
            </div>
          </div>

        {/* White card form area */}
          <div className="bg-gray-50 pb-8">
            <div className="bg-white mx-4 -mt-6 rounded-2xl shadow-xl px-6 py-7 relative z-10">

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <span className="text-red-700 text-sm">{error}</span>
                </div>
              )}

              {/* Social Auth */}
              <div className="space-y-3 mb-5">
                <CustomGoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onFailure={() => setError('Google Sign-In Failed')}
                  buttonText={isLogin ? "Sign in with Google" : "Sign up with Google"}
                  isLoading={loading}
                />
                <FacebookLogin
                  onFailure={handleFacebookFailure}
                  buttonText={isLogin ? "Continue with Facebook" : "Sign up with Facebook"}
                />
              </div>

              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-wider font-semibold">
                  <span className="px-4 bg-white text-gray-400">Or continue with email</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <input
                        type="text"
                        required={!isLogin}
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                        placeholder="Enter your full name"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                      placeholder="name@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={formData.password}
                      onChange={e => setFormData({ ...formData, password: e.target.value })}
                      className="w-full pl-10 pr-11 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                      placeholder="••••••••"
                      autoComplete={isLogin ? "current-password" : "new-password"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {!isLogin && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Account Type</label>
                    <div className="relative">
                      <UserCheck className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
                      <select
                        value={formData.role}
                        onChange={(e) => setFormData({ ...formData, role: e.target.value as 'user' | 'agent' | 'analytics' })}
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm appearance-none cursor-pointer"
                      >
                        <option value="user">Customer / User</option>
                      </select>
                      <ArrowRight className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 rotate-90 pointer-events-none" />
                    </div>
                  </div>
                )}

                {isLogin && (
                  <div className="text-right -mt-1">
                    <Link to="/forgot-password" className="text-xs font-semibold text-blue-600 hover:text-blue-500">
                      Forgot password?
                    </Link>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/30 flex justify-center items-center gap-2 text-sm mt-1"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      {isLogin ? 'Sign In' : 'Create Account'}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-5 text-center text-sm text-gray-500">
                {isLogin ? "Don't have an account?" : "Already have an account?"}{' '}
                <button
                  onClick={() => { setIsLogin(!isLogin); setError(''); }}
                  className="font-bold text-blue-600 hover:text-blue-500"
                >
                  {isLogin ? 'Sign up' : 'Log in'}
                </button>
              </div>

              {!isLogin && (
                <p className="mt-4 text-center text-[11px] text-gray-400 leading-relaxed">
                  By creating an account, you agree to our{' '}
                  <Link to="/terms-of-service" className="text-blue-600 font-semibold hover:underline">Terms of Service</Link>
                  {' '}and{' '}
                  <Link to="/privacy-policy" className="text-blue-600 font-semibold hover:underline">Privacy Policy</Link>.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── DESKTOP: Original two-column layout ── */}
        <div className="hidden lg:flex w-full">
          {/* Left Side - Blue Gradient */}
          <div className="lg:w-1/2 bg-gradient-to-br from-blue-600 to-blue-800 relative overflow-hidden flex">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-20 left-20 w-32 h-32 bg-white rounded-full"></div>
              <div className="absolute bottom-32 right-20 w-24 h-24 bg-blue-300 rounded-full"></div>
              <div className="absolute top-1/2 right-1/3 w-16 h-16 bg-blue-400 rounded-full"></div>
            </div>

            <div className="relative z-10 flex flex-col px-12 py-8 w-full">
              {/* Logo */}
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-white">QuickFix</span>
                <span className="text-sm text-blue-200 ml-1">AI Powered Support</span>
              </div>

              <Link to="/" className="text-white hover:text-blue-200 transition-all duration-200 flex items-center gap-2 font-medium text-base mb-6">
                <ArrowLeft className="w-5 h-5" />
                Back to Home
              </Link>

              <h1 className="text-4xl font-bold text-white mb-4">
                {isLogin ? 'Welcome Back!' : 'Join our Community'}
              </h1>
              <p className="text-xl text-blue-100 max-w-md">
                {isLogin
                  ? 'Access your intelligent complaint management dashboard.'
                  : 'Start your journey with AI-powered customer service automation.'}
              </p>

              <div className="mt-auto pt-6">
                <div className="relative">
                  <img
                    src={isLogin ? "/login.png" : "/Signup.webp"}
                    alt="QuickFix Platform"
                    className="w-full max-w-2xl h-auto rounded-xl shadow-2xl"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-blue-600/20 to-transparent rounded-lg"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side - Form */}
          <div className="lg:w-1/2 flex flex-col justify-center items-center px-12 py-10 bg-white overflow-y-auto">
            <div className="max-w-[420px] w-full">
              <div className="text-center mb-6 sm:mb-8">
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
                  {isLogin ? 'Sign In' : 'Create Account'}
                </h2>
                <p className="text-gray-500 text-sm sm:text-base">
                  {isLogin ? 'Please enter your details.' : 'Get started for free!'}
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 animate-fadeIn">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <span className="text-red-700 text-sm">{error}</span>
                </div>
              )}

              <div className="space-y-3 mb-6">
                <CustomGoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onFailure={() => setError('Google Sign-In Failed')}
                  buttonText={isLogin ? "Sign in with Google" : "Sign up with Google"}
                  isLoading={loading}
                />
                <FacebookLogin
                  onFailure={handleFacebookFailure}
                  buttonText={isLogin ? "Continue with Facebook" : "Sign up with Facebook"}
                />
              </div>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200"></div>
                </div>
                <div className="relative flex justify-center text-xs sm:text-sm uppercase tracking-wider font-bold">
                  <span className="px-5 bg-white text-gray-400">Or continue with email</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-2.5">
                {!isLogin && (
                  <div className="group">
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 ml-1">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 group-focus-within:text-blue-500 transition-colors" />
                      <input
                        type="text"
                        required={!isLogin}
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        className="w-full pl-11 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-sm font-medium"
                        placeholder="Enter your name"
                      />
                    </div>
                  </div>
                )}

                <div className="group">
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5 ml-1">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 group-focus-within:text-blue-500 transition-colors" />
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      className="w-full pl-11 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-sm font-medium"
                      placeholder="name@example.com"
                    />
                  </div>
                </div>

                <div className="group">
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5 ml-1">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 group-focus-within:text-blue-500 transition-colors" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={formData.password}
                      onChange={e => setFormData({ ...formData, password: e.target.value })}
                      className="w-full pl-11 pr-12 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-sm font-medium"
                      placeholder="••••••••"
                      autoComplete={isLogin ? "current-password" : "new-password"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1.5"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {!isLogin && (
                  <div className="group">
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 ml-1">Account Type</label>
                    <div className="relative">
                      <UserCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 pointer-events-none" />
                      <select
                        value={formData.role}
                        onChange={(e) => setFormData({ ...formData, role: e.target.value as 'user' | 'agent' | 'analytics' })}
                        className="w-full pl-11 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-sm font-medium appearance-none cursor-pointer"
                      >
                        <option value="user">Customer / User</option>
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                        <ArrowRight className="w-5 h-5 text-gray-400 rotate-90" />
                      </div>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-blue-500/25 flex justify-center items-center gap-2 text-sm mt-2"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      {isLogin ? 'Sign In' : 'Create Account'}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {isLogin && (
                  <div className="text-center pt-1">
                    <Link to="/forgot-password" className="text-sm font-bold text-blue-600 hover:text-blue-500 hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                )}
              </form>

              <div className="mt-6 text-center text-sm text-gray-600 font-medium">
                {isLogin ? "Don't have an account?" : "Already have an account?"}{' '}
                <button
                  onClick={() => { setIsLogin(!isLogin); setError(''); }}
                  className="font-bold text-blue-600 hover:text-blue-500 hover:underline"
                >
                  {isLogin ? 'Sign up' : 'Log in'}
                </button>
              </div>

              {!isLogin && (
                <p className="mt-5 text-center text-[11px] text-gray-400 font-medium leading-normal">
                  By creating an account, you agree to our{' '}
                  <Link to="/terms-of-service" className="text-gray-500 hover:underline font-bold text-blue-600">Terms of Service</Link>
                  {' '}and{' '}
                  <Link to="/privacy-policy" className="text-gray-500 hover:underline font-bold text-blue-600">Privacy Policy</Link>.
                </p>
              )}
            </div>
          </div>
        </div>

      </div>
    </GoogleOAuthProvider>
  );
}