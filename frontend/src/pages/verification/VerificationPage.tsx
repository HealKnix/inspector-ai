import { useSearchParams } from "react-router-dom";

import { ObjectVerificationWorkspace } from "./components/ObjectVerificationWorkspace";
import { VerificationObjectIndex } from "./components/VerificationObjectIndex";

export function VerificationPage() {
  const [searchParams] = useSearchParams();
  const objectId = searchParams.get("objectId")?.trim();

  return objectId ? (
    <ObjectVerificationWorkspace key={objectId} objectId={objectId} />
  ) : (
    <VerificationObjectIndex />
  );
}
