import {
  CompletionArgs,
  CompletionResponse,
  ExtractionArgs,
  ExtractionResponse,
  GoogleCredentials,
  GoogleLLMParams,
  ModelInterface,
  OperationMode,
} from "../types";
import { convertKeysToSnakeCase, encodeImageToBase64 } from "../utils";
import { CONSISTENCY_PROMPT, SYSTEM_PROMPT_BASE } from "../constants";
import { GoogleGenerativeAI } from "@google/generative-ai";

export default class GoogleModel implements ModelInterface {
  private client: GoogleGenerativeAI;
  private mode: OperationMode;
  private model: string;
  private llmParams?: Partial<GoogleLLMParams>;

  constructor(
    credentials: GoogleCredentials,
    mode: OperationMode,
    model: string,
    llmParams?: Partial<GoogleLLMParams>
  ) {
    this.client = new GoogleGenerativeAI(credentials.apiKey);
    this.mode = mode;
    this.model = model;
    this.llmParams = llmParams;
  }

  async getCompletion(
    params: CompletionArgs | ExtractionArgs
  ): Promise<CompletionResponse | ExtractionResponse> {
    const modeHandlers = {
      [OperationMode.EXTRACTION]: () =>
        this.handleExtraction(params as ExtractionArgs),
      [OperationMode.OCR]: () => this.handleOCR(params as CompletionArgs),
    };

    const handler = modeHandlers[this.mode];
    if (!handler) {
      throw new Error(`Unsupported operation mode: ${this.mode}`);
    }

    return await handler();
  }

  private async handleOCR({
    image,
    maintainFormat,
    priorPage,
  }: CompletionArgs): Promise<CompletionResponse> {
    const generativeModel = this.client.getGenerativeModel({
      generationConfig: convertKeysToSnakeCase(this.llmParams ?? null),
      model: this.model,
    });

    // Build the prompt parts
    const promptParts = [];

    // Add system prompt
    promptParts.push({ text: SYSTEM_PROMPT_BASE });

    // If content has already been generated, add it to context
    if (maintainFormat && priorPage && priorPage.length) {
      promptParts.push({ text: CONSISTENCY_PROMPT(priorPage) });
    }

    // Add image to request
    const base64Image = await encodeImageToBase64(image);
    const imageData = {
      inlineData: {
        data: base64Image,
        mimeType: "image/png",
      },
    };
    promptParts.push(imageData);

    try {
      const result = await generativeModel.generateContent({
        contents: [{ role: "user", parts: promptParts }],
      });

      const response = await result.response;

      return {
        content: response.text(),
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
      };
    } catch (err) {
      console.error("Error in Google completion", err);
      throw err;
    }
  }

  private async handleExtraction({
    image,
    schema,
  }: ExtractionArgs): Promise<ExtractionResponse> {
    const generativeModel = this.client.getGenerativeModel({
      generationConfig: {
        ...convertKeysToSnakeCase(this.llmParams ?? null),
        responseMimeType: "application/json",
        responseSchema: schema,
      },
      model: this.model,
    });

    // Build the prompt parts
    const promptParts = [];

    // Add system prompt
    const text = "Extract schema data from the following image";
    promptParts.push({ text });

    const base64Image = await encodeImageToBase64(image);
    const imageData = {
      inlineData: {
        data: base64Image,
        mimeType: "image/png",
      },
    };
    promptParts.push(imageData);

    try {
      const result = await generativeModel.generateContent({
        contents: [{ role: "user", parts: promptParts }],
      });

      const response = await result.response;

      return {
        extracted: JSON.parse(response.text()),
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
      };
    } catch (err) {
      console.error("Error in Google completion", err);
      throw err;
    }
  }
}
