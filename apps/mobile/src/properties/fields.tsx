import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { copyText, type CopyKey } from '../copy/userFacing';
import { nextDueDateRangeMessage } from '../dates/nextDueDate';
import { BRAND_TEAL } from '../theme/brand';

export function FormNotice({ copyKey }: { copyKey: CopyKey | null }) {
  if (!copyKey) {
    return null;
  }
  const role = copyKey === 'pay.sync.conflict' ? 'text' : 'alert';
  const text =
    copyKey === 'obligation.nextDueDate.outOfRange' ? nextDueDateRangeMessage() : copyText(copyKey);
  return (
    <Text accessibilityRole={role} testID="form-notice">
      {text}
    </Text>
  );
}

export function LabeledInput({
  label,
  value,
  onChangeText,
  testID,
  multiline = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  testID: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        maxLength={maxLength}
        style={[styles.input, multiline ? styles.notes : null]}
      />
    </View>
  );
}

export function ChoiceRow<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: T | null;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.choices}>
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(option.value)}
              style={[styles.choice, isSelected ? styles.choiceOn : null]}
            >
              <Text style={styles.choiceLabel}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={styles.button}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 8,
  },
  label: {
    color: '#14221E',
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    borderColor: '#C5D5D0',
    borderRadius: 8,
    borderWidth: 1,
    color: '#14221E',
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  notes: {
    minHeight: 96,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choice: {
    borderColor: '#C5D5D0',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  choiceOn: {
    backgroundColor: '#E7F0EE',
    borderColor: BRAND_TEAL,
  },
  choiceLabel: {
    color: '#14221E',
    fontSize: 16,
  },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: BRAND_TEAL,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
