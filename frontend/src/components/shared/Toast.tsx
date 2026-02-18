import React, { useEffect, useState, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheckCircle, faExclamationCircle, faTimes } from '@fortawesome/free-solid-svg-icons';

export interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, duration = 3000, onClose }) => {
  const [isExiting, setIsExiting] = useState(false);

  const handleExit = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 300); // Wait for exit animation to complete
  }, [onClose]);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleExit();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, handleExit]);

  const handleClose = () => {
    handleExit();
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return faCheckCircle;
      case 'error':
        return faExclamationCircle;
      case 'info':
        return faExclamationCircle;
      default:
        return faExclamationCircle;
    }
  };

  const getColors = () => {
    switch (type) {
      case 'success':
        return {
          bg: 'rgba(16, 185, 129, 0.25)',
          border: 'rgba(16, 185, 129, 0.4)',
          icon: '#10b981'
        };
      case 'error':
        return {
          bg: 'rgba(239, 68, 68, 0.25)',
          border: 'rgba(239, 68, 68, 0.4)',
          icon: '#ef4444'
        };
      case 'info':
      default:
        return {
          bg: 'rgba(255, 192, 251, 0.25)',
          border: 'rgba(255, 192, 251, 0.4)',
          icon: 'rgb(255 192 251)'
        };
    }
  };

  const colors = getColors();

  return (
    <div
      style={{
        animation: `${isExiting ? 'slideOut' : 'slideIn'} 0.3s ease-out ${isExiting ? 'forwards' : ''}`
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '16px 20px',
          background: colors.bg,
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: `1px solid ${colors.border}`,
          borderRadius: '12px',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
          minWidth: '300px',
          maxWidth: '500px',
          opacity: isExiting ? 0 : 1,
          transform: isExiting ? 'translateX(100%)' : 'translateX(0)',
          transition: 'opacity 0.3s ease-out, transform 0.3s ease-out'
        }}
      >
        <FontAwesomeIcon
          icon={getIcon()}
          style={{ fontSize: '1.25rem', color: colors.icon }}
        />
        <span
          style={{
            flex: 1,
            color: 'rgba(255, 255, 255, 0.9)',
            fontSize: '0.875rem',
            fontWeight: 500
          }}
        >
          {message}
        </span>
        <button
          onClick={handleClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255, 255, 255, 0.5)',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)'}
        >
          <FontAwesomeIcon icon={faTimes} style={{ fontSize: '0.875rem' }} />
        </button>
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
};

export default Toast;
