import {
  Description,
  FieldError,
  Input as HeroInput,
  InputGroup,
  Label,
  SearchField,
  TextField,
} from "@heroui/react";
import type { ComponentProps, ReactNode } from "react";

type HeroInputProps = ComponentProps<typeof HeroInput>;
type HeroSearchFieldProps = ComponentProps<typeof SearchField>;

interface FieldChromeProps {
  className?: string;
  description?: ReactNode;
  errorMessage?: ReactNode;
  inputClassName?: string;
  isDisabled?: boolean;
  isInvalid?: boolean;
  isReadOnly?: boolean;
  isRequired?: boolean;
  label?: ReactNode;
  validationBehavior?: "aria" | "native";
}

type TextInputType =
  | "button"
  | "checkbox"
  | "color"
  | "date"
  | "datetime-local"
  | "email"
  | "file"
  | "hidden"
  | "image"
  | "month"
  | "number"
  | "password"
  | "radio"
  | "range"
  | "reset"
  | "submit"
  | "tel"
  | "text"
  | "time"
  | "url"
  | "week";

export interface TextInputProps
  extends FieldChromeProps, Omit<HeroInputProps, "className" | "type"> {
  endContent?: ReactNode;
  startContent?: ReactNode;
  type?: TextInputType;
}

export interface SearchInputProps
  extends
    FieldChromeProps,
    Omit<
      HeroSearchFieldProps,
      | "children"
      | "className"
      | "isDisabled"
      | "isInvalid"
      | "isReadOnly"
      | "isRequired"
      | "validationBehavior"
    > {
  clearButtonLabel?: string;
  endContent?: ReactNode;
  placeholder?: string;
  startContent?: ReactNode;
  type: "search";
}

export type InputProps = TextInputProps | SearchInputProps;

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

function FieldChrome({
  children,
  description,
  errorMessage,
  invalid,
  label,
}: {
  children: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  invalid: boolean;
  label?: ReactNode;
}) {
  return (
    <>
      {label !== undefined && <Label>{label}</Label>}
      {children}
      {!invalid && description !== undefined && (
        <Description>{description}</Description>
      )}
      <FieldError>{errorMessage}</FieldError>
    </>
  );
}

function TextInput({
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
}: TextInputProps) {
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
      <FieldChrome
        description={description}
        errorMessage={errorMessage}
        invalid={invalid}
        label={label}
      >
        <InputControl className={inputClassName} name={name} {...inputProps} />
      </FieldChrome>
    </TextField>
  );
}

function SearchInput({
  className,
  clearButtonLabel = "Очистить",
  description,
  endContent,
  errorMessage,
  fullWidth,
  inputClassName,
  isDisabled,
  isInvalid,
  isReadOnly,
  isRequired,
  label,
  placeholder,
  startContent,
  type,
  validationBehavior,
  ...searchFieldProps
}: SearchInputProps) {
  const invalid = isInvalid || Boolean(errorMessage);

  return (
    <SearchField
      className={className}
      fullWidth={fullWidth}
      isDisabled={isDisabled}
      isInvalid={invalid}
      isReadOnly={isReadOnly}
      isRequired={isRequired}
      validationBehavior={validationBehavior}
      {...searchFieldProps}
    >
      <FieldChrome
        description={description}
        errorMessage={errorMessage}
        invalid={invalid}
        label={label}
      >
        <SearchField.Group className={inputClassName ?? "rounded-xl"}>
          {startContent !== undefined ? (
            startContent
          ) : (
            <SearchField.SearchIcon />
          )}
          <SearchField.Input placeholder={placeholder} type={type} />
          {endContent !== undefined ? (
            endContent
          ) : (
            <SearchField.ClearButton aria-label={clearButtonLabel} />
          )}
        </SearchField.Group>
      </FieldChrome>
    </SearchField>
  );
}

export function Input(props: InputProps) {
  if (props.type === "search") {
    return <SearchInput {...props} />;
  }

  return <TextInput {...props} />;
}
