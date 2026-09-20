class RouteNames {
  ROOT = "/";

  // Объекты
  OBJECTS = "/objects";
  OBJECT_DETAILS = (id: string, search?: string) =>
    `${this.OBJECTS}/${id}${search ?? ""}`;

  // Документы
  DOCUMENT_UPLOAD = "/documents/upload";
  DOCUMENT_VERIFICATION = "/verification";
  DOCUMENT_VERIFICATION_DETAILS = (objectId: string) =>
    `${this.DOCUMENT_VERIFICATION}?objectId=${encodeURIComponent(objectId)}`;

  // Авторизация
  LOGIN = "/login";
  REGISTER = "/register";

  // 404
  NOT_FOUND = "*";
}

const routeNames = new RouteNames();

export default routeNames;
