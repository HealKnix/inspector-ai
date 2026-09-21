import {
  Description,
  FieldError,
  Input as HeroInput,
  InputGroup,
  Label,
  TextField,
} from "@heroui/react";
import type { ComponentProps, ReactNode } from "react";

type HeroInputProps = ComponentProps<typeof HeroInput>;

export interface InputProps extends Omit<HeroInputProps, "className"> {
  className?: string;
  description?: ReactNode;
  endContent?: ReactNode;
  errorMessage?: ReactNode;
  inputClassName?: string;
  isDisabled?: boolean;
  isInvalid?: boolean;
  isReadOnly?: boolean;
  isRequired?: boolean;
  label?: ReactNode;
  startContent?: ReactNode;
  validationBehavior?: "aria" | "native";
}

interface InputControlProps extends Omit<HeroInputProps, "className"> {
  className?: string;
  endContent?: ReactNode;
  startContent?: ReactNode;
}

function InputControl({
  className,
  endContent,
  startContent,
  ...props
}: InputControlProps) {
  if (startContent === undefined && endContent === undefined) {
    return <HeroInput className={className} {...props} />;
  }

  const ariaInvalid = props["aria-invalid"];

  return (
    <InputGroup
      className={className}
      {...(props.disabled !== undefined ? { isDisabled: props.disabled } : {})}
      {...(ariaInvalid !== undefined
        ? { isInvalid: ariaInvalid === true || ariaInvalid === "true" }
        : {})}
    >
      {startContent !== undefined && (
        <InputGroup.Prefix>{startContent}</InputGroup.Prefix>
      )}
      <InputGroup.Input {...props} />
      {endContent !== undefined && (
        <InputGroup.Suffix>{endContent}</InputGroup.Suffix>
      )}
    </InputGroup>
  );
}

export function Input({
  className,
  description,
  errorMessage,
  fullWidth,
  inputClassName,
  isDisabled,
  isInvalid,
  isReadOnly,
  isRequired,
  label,
  name,
  validationBehavior,
  ...inputProps
}: InputProps) {
  const invalid = isInvalid || Boolean(errorMessage);

  return (
    <TextField
      aria-label={inputProps["aria-label"]}
      aria-labelledby={inputProps["aria-labelledby"]}
      className={className}
      fullWidth={fullWidth}
      isDisabled={isDisabled}
      isInvalid={invalid}
      isReadOnly={isReadOnly}
      isRequired={isRequired}
      name={name}
      validationBehavior={validationBehavior}
    >
      {label !== undefined && <Label>{label}</Label>}
      <InputControl className={inputClassName} name={name} {...inputProps} />
      {!invalid && description !== undefined && (
        <Description>{description}</Description>
      )}
      <FieldError>{errorMessage}</FieldError>
    </TextField>
  );
}
