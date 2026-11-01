import api from '../utils/api';
import React, {
  useEffect,
  useState,
  ReactNode,
  useCallback,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../hooks/useAuth';
import { useTokenValidation } from '../hooks/useTokenValidation';
import {
  SocketContext,
  NotificationType,
  OnlineUser,
  ComplaintUpdate,
  SocketContextType
} from './SocketContextStore';

// -------------------- Provider Component --------------------

interface SocketProviderProps {
  children: ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const { user, logout } = useAuth();
  const { checkTokenExpiration, refreshToken } = useTokenValidation();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState<NotificationType[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);

  // Request browser notification permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {
        // Notification permission request failed
      });
    }
  }, []);

  // -------------------- Setup Socket Event Listeners --------------------
  const setupSocketListeners = useCallback(
    (newSocket: Socket) => {
      newSocket.on('connect', () => {
        // Don't set isConnected=true yet - wait for connection_success from server
      });

      newSocket.on('disconnect', () => {
        setIsConnected(false);
      });

      newSocket.on('connection_success', () => {
        setIsConnected(true);
      });

      newSocket.on('connection_error', () => {
        setIsConnected(false);
        // Disconnect and try again with fresh token
        newSocket.disconnect();

        // Try to refresh token and reconnect
        setTimeout(() => {
          refreshToken(); // Use refreshToken directly instead
        }, 1000);
      });

      newSocket.on('connect_error', (error) => {
        setIsConnected(false);

        if (
          error.message.includes('auth') ||
          error.message.includes('token') ||
          error.message.includes('Invalid user')
        ) {
          checkTokenExpiration().catch(() => {
            localStorage.removeItem('token');
          });
        }
      });

      // Authenticated event
      newSocket.on(
        'connected',
        (data: { user: Record<string, unknown>; unreadNotifications: NotificationType[] }) => {
          setNotifications(data.unreadNotifications || []);
        }
      );

      // -------------------- Notifications --------------------
      newSocket.on('notification', (data: { notification: NotificationType }) => {
        setNotifications((prev) => [data.notification, ...prev]);

        if (Notification.permission === 'granted') {
          new Notification(data.notification.title, {
            body: data.notification.message,
            icon: '/logo.svg',
          });
        }
      });

      // -------------------- Real-Time Events --------------------
      newSocket.on('online_users', (users: OnlineUser[]) => {
        setOnlineUsers(users);
      });

      // Listen for new complaints (admin and agent dashboards)
      newSocket.on('new_complaint', (complaint) => {
        window.dispatchEvent(new CustomEvent('newComplaint', { detail: complaint }));

        // Show browser notification
        if (Notification.permission === 'granted') {
          new Notification('New Complaint Filed', {
            body: `${complaint.title} - ${complaint.description?.substring(0, 50)}...`,
            icon: '/logo.svg',
          });
        }
      });

      // Listen for complaint status updates (multiple event names for compatibility)
      newSocket.on('complaint_status_update', (data) => {
        window.dispatchEvent(new CustomEvent('complaintStatusUpdate', { detail: data }));

        // Show browser notification
        if (Notification.permission === 'granted') {
          new Notification('Complaint Status Updated', {
            body: `Complaint #${data.complaintId} status is now ${data.status}`,
            icon: '/logo.svg',
          });
        }
      });

      // Listen for complaintUpdated event (main event from backend)
      newSocket.on('complaintUpdated', (data) => {
        window.dispatchEvent(new CustomEvent('complaintUpdated', { detail: data }));

        // Show browser notification for resolved complaints
        if (data.complaint?.status === 'Resolved' && Notification.permission === 'granted') {
          new Notification('Complaint Resolved! 🎉', {
            body: `Your complaint "${data.complaint.title}" has been resolved!`,
            icon: '/logo.svg',
          });
        }
      });

      newSocket.on('complaint_status_updated', (data) => {
        window.dispatchEvent(new CustomEvent('complaintUpdated', { detail: data }));
      });

      newSocket.on('complaint_assigned', (data) => {
        window.dispatchEvent(new CustomEvent('complaintAssigned', { detail: data }));

        // Show browser notification
        if (Notification.permission === 'granted') {
          const title = user?.role === 'agent' ?
            'New Complaint Assigned' :
            'Agent Assigned to Your Complaint';

          const body = user?.role === 'agent' ?
            `Complaint "${data.complaint?.title || 'New complaint'}" has been assigned to you` :
            `Agent ${data.agentName} has been assigned to your complaint`;

          new Notification(title, {
            body,
            icon: '/logo.svg',
          });
        }
      });

      newSocket.on('dashboard_stats_update', (data) => {
        window.dispatchEvent(new CustomEvent('dashboardStatsUpdate', { detail: data }));
      });

      newSocket.on('agent_status_update', (agents) => {
        window.dispatchEvent(new CustomEvent('agentStatusUpdate', { detail: { agents } }));
      });

      newSocket.on('dashboard_update', (data) => {
        window.dispatchEvent(new CustomEvent('dashboardUpdate', { detail: data }));
      });

      newSocket.on('new_message', (data) => {
        window.dispatchEvent(new CustomEvent('newMessage', { detail: data }));
      });

      newSocket.on('internal_message', (data) => {
        window.dispatchEvent(new CustomEvent('internalMessage', { detail: data }));
      });

      newSocket.on('user_typing', (data) => {
        window.dispatchEvent(new CustomEvent('userTyping', { detail: data }));
      });

      newSocket.on('user_stopped_typing', (data) => {
        window.dispatchEvent(new CustomEvent('userStoppedTyping', { detail: data }));
      });

      // -------------------- Error Handling --------------------
      newSocket.on('error', (error: { message: string }) => {
        // Maintain a counter of errors in localStorage to prevent infinite loops
        const errorCount = parseInt(localStorage.getItem('socketErrorCount') || '0', 10);
        const errorTime = parseInt(localStorage.getItem('socketErrorTime') || '0', 10);
        const now = Date.now();

        // Reset error count if last error was more than 1 minute ago
        if (now - errorTime > 60000) {
          localStorage.setItem('socketErrorCount', '1');
          localStorage.setItem('socketErrorTime', now.toString());
        } else {
          // Increment error count
          localStorage.setItem('socketErrorCount', (errorCount + 1).toString());
          localStorage.setItem('socketErrorTime', now.toString());

          // If too many errors in a short time, back off reconnection attempts
          if (errorCount > 5) {
            return; // Don't attempt to reconnect immediately
          }
        }

        // Handle "New login" message specifically to prevent reconnection loops
        if (error.message === 'New login detected from another device') {
          // Mark this as a duplicate connection in localStorage to prevent immediate reconnect
          localStorage.setItem('socketDuplicateDetected', Date.now().toString());
          // Don't take any action, the server is handling the duplicate login
          return;
        }

        // Handle connection failures
        if (error.message?.includes('failed') || error.message?.includes('refused')) {
          // Track the failure time to avoid rapid reconnection attempts
          localStorage.setItem('socketConnectionFailure', Date.now().toString());
        }

        // Handle all authentication-related errors
        if (error.message === 'Invalid user' ||
          error.message === 'Authentication failed' ||
          error.message === 'Token expired' ||
          error.message === 'Invalid token payload') {

          // Force disconnect the socket immediately
          newSocket.disconnect();

          // Wait a bit before trying to refresh token to prevent rapid attempts
          setTimeout(() => {
            // Try direct token refresh instead of checkTokenExpiration
            refreshToken()
              .then((isValid: boolean) => {
                if (isValid) {
                  // Reset error count since we successfully refreshed
                  localStorage.setItem('socketErrorCount', '0');
                  // Let the useEffect handle reconnection rather than doing it here
                  // This avoids having multiple socket connections
                } else {
                  localStorage.removeItem('token');
                  localStorage.removeItem('refreshToken');
                  logout();
                }
              })
              .catch(() => {
                localStorage.removeItem('token');
                localStorage.removeItem('refreshToken');
                logout();
              });
          }, 2000);
        }
      });

      // -------------------- Reconnection Handling --------------------
      newSocket.io.on('reconnect_attempt', () => {
        const freshToken = localStorage.getItem('token');
        if (freshToken) newSocket.auth = { token: freshToken };
      });
    },
    // Remove dependencies that cause circular updates and only depend on role changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.role]
  );

  // -------------------- Socket Actions --------------------

  // Join a complaint room to receive real-time updates about a specific complaint
  const joinComplaintRoom = useCallback((complaintId: string) => {
    if (!socket || !isConnected) return;
    socket.emit('join_complaint', { complaintId });
  }, [socket, isConnected]);

  // Leave a complaint room
  const leaveComplaintRoom = useCallback((complaintId: string) => {
    if (!socket || !isConnected) return;
    socket.emit('leave_complaint', { complaintId });
  }, [socket, isConnected]);

  // Send a message in a complaint thread
  const sendMessage = useCallback((complaintId: string, message: string, isInternal: boolean = false) => {
    if (!socket || !isConnected) return;
    socket.emit('send_message', {
      complaintId,
      message,
      isInternal
    });
  }, [socket, isConnected]);

  // Update a complaint (status, priority, etc.)
  const updateComplaint = useCallback((complaintId: string, updates: ComplaintUpdate, note?: string) => {
    if (!socket || !isConnected) return;

    // Handle status updates specially for tracking history
    if (updates.status) {
      socket.emit('update_complaint_status', {
        complaintId,
        status: updates.status,
        note
      });
    }

    // Handle other updates
    if (updates.priority || updates.category) {
      socket.emit('update_complaint_details', {
        complaintId,
        updates
      });
    }

    // Handle assignment
    if (updates.assignedTo) {
      socket.emit('assign_complaint', {
        complaintId,
        agentId: updates.assignedTo
      });
    }
  }, [socket, isConnected]);

  // Mark notifications as read
  const markNotificationsRead = useCallback((notificationIds: string[]) => {
    if (!socket || !isConnected || !notificationIds.length) return;

    socket.emit('mark_notifications_read', { notificationIds });

    // Update local state optimistically
    setNotifications(prev =>
      prev.map(notification =>
        notificationIds.includes(notification._id)
          ? { ...notification, isRead: true }
          : notification
      )
    );
  }, [socket, isConnected]);

  // Notify about a new complaint being created (after API call)
  const notifyNewComplaint = useCallback((complaintId: string) => {
    if (!socket || !isConnected) return;
    socket.emit('new_complaint_created', { complaintId });
  }, [socket, isConnected]);

  // -------------------- Socket Connection --------------------
  const connectSocket = useCallback(
    (token: string) => {
      // Decode token to verify its structure and extract userId
      let userId = null;
      try {
        const tokenParts = token.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(atob(tokenParts[1]));

          // Extract user ID from token - backend expects 'id' as the key
          userId = payload.id || payload.userId || payload.sub;

          // Check for critical fields
          if (!userId) {
            // Last resort: look for any field that looks like a MongoDB ObjectId
            for (const key in payload) {
              if (typeof payload[key] === 'string' && /^[0-9a-fA-F]{24}$/.test(payload[key])) {
                userId = payload[key];
                break;
              }
            }
          }

          // Check token expiration
          if (payload.exp) {
            const expiresIn = payload.exp * 1000 - Date.now();

            if (expiresIn < 0) {
              return null; // Don't even try to connect with expired token
            }
          }
        }
      } catch {
        // Silently fail
      }

      // Get user from local storage as fallback for userId
      const userStr = localStorage.getItem('user');
      if (userStr && !userId) {
        try {
          const userObj = JSON.parse(userStr);
          userId = userObj?.id;
        } catch {
          // Silently fail
        }
      }

      // Verify token one more time before connecting
      if (!token) {
        return null;
      }

      // First validate token to avoid connection attempts with invalid tokens
      try {
        // Simple client-side check for token validity
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) {
          return null;
        }

        // Check if token is expired
        const payload = JSON.parse(atob(tokenParts[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          return null;
        }
      } catch {
        return null;
      }

      // Use dedicated socket URL from environment variables, or fallback to API URL
      const baseURL = import.meta.env.VITE_SOCKET_SERVER_URL || 'http://localhost:5001';

      const socketOptions = {
        auth: {
          token // Simplified to just include the token
        },
        withCredentials: true,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        timeout: 10000,
        forceNew: true
      };

      try {
        const socket = io(baseURL, socketOptions);
        setupSocketListeners(socket);
        setSocket(socket);
        return socket;
      } catch {
        return null;
      }
    },
    // setupSocketListeners is stable since we fixed its dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Track socket connection attempts to prevent loops
  const [connectionAttemptCount, setConnectionAttemptCount] = useState<number>(0);
  const [lastConnectionAttempt, setLastConnectionAttempt] = useState<number>(0);

  // -------------------- Manage Lifecycle --------------------
  useEffect(() => {
    // Track if component is still mounted for async operations
    let isMounted = true;

    // If no user, disconnect and clean up
    if (!user) {
      if (socket) {
        // Fix 2: Remove all listeners before disconnecting to prevent MaxListenersExceededWarning.
        // Without this, each reconnect accumulates listeners on the same underlying EventEmitter.
        socket.removeAllListeners();
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
      return () => { isMounted = false; };
    }

    // Fix 3 (singleton pattern): If socket already connected, reuse it — never create a second instance.
    // Multiple io() instances share the same underlying transport streams, causing ObjectMultiplex
    // "orphaned data" and "malformed chunk" errors when the old instance's streams receive data
    // intended for the new one.
    if (socket && socket.connected) {
      return () => { isMounted = false; };
    }

    // Enforce a minimum time between connection attempts to prevent rapid reconnections
    const now = Date.now();
    const MIN_RECONNECT_INTERVAL = 10000; // 10 seconds between attempts

    if (now - lastConnectionAttempt < MIN_RECONNECT_INTERVAL) {
      return () => { isMounted = false; };
    }

    // Limit total number of connection attempts to prevent infinite loops
    const MAX_ATTEMPTS = 3;
    if (connectionAttemptCount >= MAX_ATTEMPTS) {
      return () => { isMounted = false; };
    }

    // Fix 2: Clean up any existing disconnected socket — remove ALL listeners first,
    // then disconnect. This ensures the old socket's EventEmitter is fully drained
    // before we create a new one, preventing listener accumulation.
    if (socket && !socket.connected) {
      socket.removeAllListeners();
      socket.disconnect();
      setSocket(null);
    }

    // Initialize socket connection process
    const initializeSocket = async () => {
      // Track this attempt
      setLastConnectionAttempt(now);
      setConnectionAttemptCount(prev => prev + 1);

      try {
        // First validate the token without calling the API
        const token = localStorage.getItem('token');
        if (!token) {
          return;
        }

        // Simple client-side token validation to avoid unnecessary API calls
        try {
          const tokenParts = token.split('.');
          if (tokenParts.length !== 3) {
            return;
          }

          const payload = JSON.parse(atob(tokenParts[1]));
          if (payload.exp && payload.exp * 1000 < Date.now()) {
            return;
          }
        } catch {
          return;
        }

        const security=await api.get('/security/mfa');
        if(security.data.enabled && !security.data.verified)return;

        // Create the socket connection with delay to prevent rapid reconnects
        setTimeout(() => {
          if (isMounted) {
            connectSocket(token);
          }
        }, 1000);
      } catch {
        // Error initializing socket
      }
    };

    initializeSocket();

    return () => {
      isMounted = false;
    };
    // Carefully control when this effect runs to prevent infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // -------------------- Helper Functions --------------------
  // Socket action functions are defined above

  // Socket room functions are defined above

  // -------------------- Context Value --------------------
  const contextValue: SocketContextType = {
    socket,
    isConnected,
    notifications,
    onlineUsers,
    sendMessage,
    updateComplaint,
    markNotificationsRead,
    joinComplaintRoom,
    leaveComplaintRoom,
    notifyNewComplaint
  };

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
};
