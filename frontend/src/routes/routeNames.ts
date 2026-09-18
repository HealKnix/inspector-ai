class RouteNames {
  ROOT = "/" as const;
  APP = "/app" as const;
  OBJECTS = "/app/objects" as const;
  OBJECT_DETAILS = "/app/objects/:objectId" as const;
  objectDetails = (id: string) => `${this.OBJECTS}/${encodeURIComponent(id)}`;
  DOCUMENT_UPLOAD = "/app/documents/upload" as const;
  NOT_FOUND = "*" as const;

  // Авторизация
  LOGIN = "/login" as const;
  REGISTER = "/register" as const;
}

const routeNames = new RouteNames();

export default routeNames;
