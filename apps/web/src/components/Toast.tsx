import { useEffect, useState } from 'react';
import { View, Animated, Dimensions } from 'react-native';
import { Text, Surface, IconButton } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

// Global toast state
let toasts: ToastMessage[] = [];
let listeners: ((toasts: ToastMessage[]) => void)[] = [];

const notifyListeners = () => {
  listeners.forEach(listener => listener([...toasts]));
};

// Global toast functions
export const showToast = (toast: Omit<ToastMessage, 'id'>) => {
  const id = Math.random().toString(36).substring(7);
  const newToast = { ...toast, id };
  
  toasts.push(newToast);
  notifyListeners();
  
  // Auto-remove after duration
  const duration = toast.duration ?? 4000;
  setTimeout(() => {
    hideToast(id);
  }, duration);
  
  return id;
};

export const hideToast = (id: string) => {
  toasts = toasts.filter(toast => toast.id !== id);
  notifyListeners();
};

export const showSuccess = (title: string, message?: string) => {
  return showToast({ type: 'success', title, message });
};

export const showError = (title: string, message?: string) => {
  return showToast({ type: 'error', title, message });
};

export const showWarning = (title: string, message?: string) => {
  return showToast({ type: 'warning', title, message });
};

export const showInfo = (title: string, message?: string) => {
  return showToast({ type: 'info', title, message });
};

// Toast component
export function Toast() {
  const [activeToasts, setActiveToasts] = useState<ToastMessage[]>([]);
  const insets = useSafeAreaInsets();
  const { width } = Dimensions.get('window');

  useEffect(() => {
    const listener = (newToasts: ToastMessage[]) => {
      setActiveToasts(newToasts);
    };
    
    listeners.push(listener);
    
    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  }, []);

  return (
    <View
      style={{
        position: 'absolute',
        top: insets.top + 10,
        left: 16,
        right: 16,
        zIndex: 9999,
        pointerEvents: 'box-none',
      }}
    >
      {activeToasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => hideToast(toast.id)}
        />
      ))}
    </View>
  );
}

interface ToastItemProps {
  toast: ToastMessage;
  onDismiss: () => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(-100));

  useEffect(() => {
    // Animate in
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 100,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const getToastConfig = (type: ToastType) => {
    switch (type) {
      case 'success':
        return {
          backgroundColor: '#4caf50',
          icon: 'check-circle',
          iconColor: 'white',
        };
      case 'error':
        return {
          backgroundColor: '#f44336',
          icon: 'alert-circle',
          iconColor: 'white',
        };
      case 'warning':
        return {
          backgroundColor: '#ff9800',
          icon: 'alert',
          iconColor: 'white',
        };
      case 'info':
        return {
          backgroundColor: '#2196f3',
          icon: 'information',
          iconColor: 'white',
        };
    }
  };

  const config = getToastConfig(toast.type);

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }],
        marginBottom: 8,
      }}
    >
      <Surface
        style={{
          backgroundColor: config.backgroundColor,
          borderRadius: 12,
          elevation: 6,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 4,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            padding: 16,
          }}
        >
          <View style={{ marginRight: 12, marginTop: 2 }}>
            <Text style={{ 
              fontSize: 20,
              color: config.iconColor,
            }}>
              {config.icon === 'check-circle' && '✓'}
              {config.icon === 'alert-circle' && '⚠'}
              {config.icon === 'alert' && '⚠'}
              {config.icon === 'information' && 'ℹ'}
            </Text>
          </View>
          
          <View style={{ flex: 1 }}>
            <Text
              variant="titleSmall"
              style={{
                color: 'white',
                fontWeight: 'bold',
                marginBottom: toast.message ? 4 : 0,
              }}
            >
              {toast.title}
            </Text>
            
            {toast.message && (
              <Text
                variant="bodySmall"
                style={{
                  color: 'white',
                  opacity: 0.9,
                }}
              >
                {toast.message}
              </Text>
            )}
          </View>
          
          <IconButton
            icon="close"
            size={18}
            iconColor="white"
            onPress={onDismiss}
            style={{ margin: -8 }}
          />
        </View>
      </Surface>
    </Animated.View>
  );
}