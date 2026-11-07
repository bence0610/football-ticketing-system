import { HttpClient, HttpContext } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";
import { SKIP_ERROR_SNACKBAR } from "../../core/interceptors/error.interceptor";
import {
  ChatbotSendRequest,
  ChatbotSendResponse,
} from "../models/chatbot.model";

@Injectable({ providedIn: "root" })
export class ChatbotApiService {
  private readonly http = inject(HttpClient);

  send(payload: ChatbotSendRequest): Observable<ChatbotSendResponse> {
    // The panel shows the failure in its own role="alert" block; no toast on top.
    return this.http.post<ChatbotSendResponse>("/chatbot/message", payload, {
      context: new HttpContext().set(SKIP_ERROR_SNACKBAR, true),
    });
  }
}
