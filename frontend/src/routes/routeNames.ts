class RouteNames {
  ROOT = "/";

  // Объекты
  OBJECTS = "/objects";

  // Документы
  OBJECT_UPLOAD = (id: string) => `${this.OBJECTS}/${id}/upload`;
  DOCUMENT_VERIFICATION = "/verification";
  DOCUMENT_VERIFICATION_DETAILS = (objectId: string) =>
    `${this.DOCUMENT_VERIFICATION}?objectId=${encodeURIComponent(objectId)}`;

  // Протоколы
  PROTOCOLS = "/protocols";
  PROTOCOL_DETAILS = (protocolId: string) => `${this.PROTOCOLS}/${protocolId}`;

  // Администрирование
  ADMIN_MATRIX = "/admin/matrix";
  ADMIN_USERS = "/admin/users";
  ADMIN_DOCUMENTS = "/admin/documents";

  // Авторизация
  LOGIN = "/login";
  REGISTER = "/register";

  // 404
  NOT_FOUND = "*";
}

const routeNames = new RouteNames();

export default routeNames;
