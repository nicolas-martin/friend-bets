import { useState } from 'react';
import { Button, ButtonProps } from 'react-native-paper';

interface TxButtonProps extends Omit<ButtonProps, 'loading'> {
  loading?: boolean;
}

export function TxButton({ 
  children,
  onPress,
  loading = false,
  disabled = false,
  ...props 
}: TxButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePress = async () => {
    if (loading || isSubmitting || disabled || !onPress) return;
    
    setIsSubmitting(true);
    try {
      await onPress();
    } catch (error) {
      console.error('Transaction error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading = loading || isSubmitting;
  
  return (
    <Button
      {...props}
      onPress={handlePress}
      loading={isLoading}
      disabled={disabled || isLoading}
      style={[
        {
          opacity: disabled && !isLoading ? 0.6 : 1,
        },
        props.style,
      ]}
    >
      {isLoading ? 'Processing...' : children}
    </Button>
  );
}