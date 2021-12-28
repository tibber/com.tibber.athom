declare module 'http.min' {
  export interface HttpRequest {
    uri: string;
    form?: { [p: string]: unknown };
  }

  export interface HttpResponse<T = string> {
    data: T;
    response: {
      statusCode: number;
    };
  }

  const http: {
    post(request: HttpRequest): Promise<HttpResponse>;
    json<T>(uri: string): Promise<HttpResponse<T>>;
  };

  export default http;
}
