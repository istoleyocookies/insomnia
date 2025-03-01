import { autoBindMethodsForReact } from 'class-autobind-decorator';
import iconv from 'iconv-lite';
import React, { Component, Fragment } from 'react';

import {
  AUTOBIND_CFG,
  HUGE_RESPONSE_MB,
  LARGE_RESPONSE_MB,
  PREVIEW_MODE_FRIENDLY,
  PREVIEW_MODE_RAW,
} from '../../../common/constants';
import { clickLink } from '../../../common/electron-helpers';
import { hotKeyRefs } from '../../../common/hotkeys';
import { executeHotKey } from '../../../common/hotkeys-listener';
import CodeEditor from '../codemirror/code-editor';
import KeydownBinder from '../keydown-binder';
import CSVViewer from './response-csv-viewer';
import ResponseError from './response-error';
import MultipartViewer from './response-multipart';
import PDFViewer from './response-pdf-viewer';
import ResponseRaw from './response-raw';
import ResponseWebView from './response-web-view';

let alwaysShowLargeResponses = false;

interface Props {
  bytes: number;
  contentType: string;
  disableHtmlPreviewJs: boolean;
  disablePreviewLinks: boolean;
  download: (...args: any[]) => any;
  editorFontSize: number;
  editorIndentSize: number;
  editorKeyMap: string;
  editorLineWrapping: boolean;
  filter: string;
  filterHistory: string[];
  getBody: (...args: any[]) => any;
  previewMode: string;
  responseId: string;
  url: string;
  updateFilter?: (filter: string) => void;
  error?: string | null;
}

interface State {
  blockingBecauseTooLarge: boolean;
  bodyBuffer: Buffer | null;
  error: string;
}

@autoBindMethodsForReact(AUTOBIND_CFG)
class ResponseViewer extends Component<Props, State> {
  _selectableView: ResponseRaw | CodeEditor | null;

  state: State = {
    blockingBecauseTooLarge: false,
    bodyBuffer: null,
    error: '',
  }

  refresh() {
    // @ts-expect-error -- TSCONVERSION refresh only exists on a code-editor, not response-raw
    if (this._selectableView != null && typeof this._selectableView.refresh === 'function') {
      // @ts-expect-error -- TSCONVERSION refresh only exists on a code-editor, not response-raw
      this._selectableView.refresh();
    }
  }

  _decodeIconv(bodyBuffer: Buffer, charset: string) {
    try {
      return iconv.decode(bodyBuffer, charset);
    } catch (err) {
      console.warn('[response] Failed to decode body', err);
      return bodyBuffer.toString();
    }
  }

  _handleDismissBlocker() {
    this.setState({
      blockingBecauseTooLarge: false,
    });

    this._maybeLoadResponseBody(this.props, true);
  }

  _handleDisableBlocker() {
    alwaysShowLargeResponses = true;

    this._handleDismissBlocker();
  }

  _maybeLoadResponseBody(props: Props, forceShow?: boolean) {
    // Block the response if it's too large
    const responseIsTooLarge = props.bytes > LARGE_RESPONSE_MB * 1024 * 1024;

    if (!forceShow && !alwaysShowLargeResponses && responseIsTooLarge) {
      this.setState({
        blockingBecauseTooLarge: true,
      });
    } else {
      try {
        const bodyBuffer = props.getBody();
        this.setState({
          bodyBuffer,
          blockingBecauseTooLarge: false,
        });
      } catch (err) {
        this.setState({
          error: `Failed reading response from filesystem: ${err.stack}`,
        });
      }
    }
  }

  // eslint-disable-next-line camelcase
  UNSAFE_componentWillMount() {
    this._maybeLoadResponseBody(this.props);
  }

  // eslint-disable-next-line camelcase
  UNSAFE_componentWillReceiveProps(nextProps: Props) {
    this._maybeLoadResponseBody(nextProps);
  }

  shouldComponentUpdate(nextProps: Props, nextState: State) {
    for (const k of Object.keys(nextProps)) {
      const next = nextProps[k];
      const current = this.props[k];

      if (typeof next === 'function') {
        continue;
      }

      if (current instanceof Buffer && next instanceof Buffer) {
        if (current.equals(next)) {
          continue;
        } else {
          return true;
        }
      }

      if (next !== current) {
        return true;
      }
    }

    for (const k of Object.keys(nextState)) {
      const next = nextState[k];
      const current = this.state[k];

      if (typeof next === 'function') {
        continue;
      }

      if (current instanceof Buffer && next instanceof Buffer) {
        if (current.equals(next)) {
          continue;
        } else {
          return true;
        }
      }

      if (next !== current) {
        return true;
      }
    }

    return false;
  }

  _setSelectableViewRef<T extends ResponseRaw | CodeEditor | null>(n: T) {
    this._selectableView = n;
  }

  _isViewSelectable() {
    return (
      this._selectableView != null &&
      typeof this._selectableView.focus === 'function' &&
      typeof this._selectableView.selectAll === 'function'
    );
  }

  _handleKeyDown(e: KeyboardEvent) {
    if (!this._isViewSelectable()) {
      return;
    }

    executeHotKey(e, hotKeyRefs.RESPONSE_FOCUS, () => {
      if (!this._isViewSelectable()) {
        return;
      }

      this._selectableView?.focus();

      this._selectableView?.selectAll();
    });
  }

  _renderView() {
    const {
      bytes,
      disableHtmlPreviewJs,
      disablePreviewLinks,
      download,
      editorFontSize,
      editorIndentSize,
      editorKeyMap,
      editorLineWrapping,
      error: responseError,
      filter,
      filterHistory,
      previewMode,
      responseId,
      updateFilter,
      url,
    } = this.props;
    let contentType = this.props.contentType;
    const { bodyBuffer, error: parseError } = this.state;
    const error = responseError || parseError;

    if (error) {
      return (
        <div className="scrollable tall">
          <ResponseError url={url} error={error} fontSize={editorFontSize} />
        </div>
      );
    }

    const wayTooLarge = bytes > HUGE_RESPONSE_MB * 1024 * 1024;
    const { blockingBecauseTooLarge } = this.state;

    if (blockingBecauseTooLarge) {
      return (
        <div className="response-pane__notify">
          {wayTooLarge ? (
            <Fragment>
              <p className="pad faint">Responses over {HUGE_RESPONSE_MB}MB cannot be shown</p>
              <button onClick={download} className="inline-block btn btn--clicky">
                Save Response To File
              </button>
            </Fragment>
          ) : (
            <Fragment>
              <p className="pad faint">
                Response over {LARGE_RESPONSE_MB}MB hidden for performance reasons
              </p>
              <div>
                <button onClick={download} className="inline-block btn btn--clicky margin-xs">
                  Save To File
                </button>
                <button
                  onClick={this._handleDismissBlocker}
                  disabled={wayTooLarge}
                  className=" inline-block btn btn--clicky margin-xs"
                >
                  Show Anyway
                </button>
              </div>
              <div className="pad-top-sm">
                <button
                  className="faint inline-block btn btn--super-compact"
                  onClick={this._handleDisableBlocker}
                >
                  Always Show
                </button>
              </div>
            </Fragment>
          )}
        </div>
      );
    }

    if (!bodyBuffer) {
      return <div className="pad faint">Failed to read response body from filesystem</div>;
    }

    if (bodyBuffer.length === 0) {
      return <div className="pad faint">No body returned for response</div>;
    }

    // Try to detect JSON in all cases (even if header is set). Apparently users
    // often send JSON with weird content-types like text/plain
    try {
      JSON.parse(bodyBuffer.toString('utf8'));
      contentType = 'application/json';
    } catch (e) {
      // Nothing
    }

    // Try to detect HTML in all cases (even if header is set). It is fairly
    // common for webservers to send errors in HTML by default.
    // NOTE: This will probably never throw but I'm not 100% so wrap anyway
    try {
      const isProbablyHTML = bodyBuffer
        .slice(0, 100)
        .toString()
        .trim()
        .match(/^<!doctype html.*>/i);

      if (contentType.indexOf('text/html') !== 0 && isProbablyHTML) {
        contentType = 'text/html';
      }
    } catch (e) {
      // Nothing
    }

    const ct = contentType.toLowerCase();

    if (previewMode === PREVIEW_MODE_FRIENDLY && ct.indexOf('image/') === 0) {
      const justContentType = contentType.split(';')[0];
      const base64Body = bodyBuffer.toString('base64');
      return (
        <div className="scrollable-container tall wide">
          <div className="scrollable">
            <img
              src={`data:${justContentType};base64,${base64Body}`}
              className="pad block"
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                margin: 'auto',
              }}
            />
          </div>
        </div>
      );
    } else if (previewMode === PREVIEW_MODE_FRIENDLY && ct.includes('html')) {
      const match = contentType.match(/charset=([\w-]+)/);
      const charset = match && match.length >= 2 ? match[1] : 'utf-8';
      return (
        <ResponseWebView
          body={this._decodeIconv(bodyBuffer, charset)}
          contentType={contentType}
          key={disableHtmlPreviewJs ? 'no-js' : 'yes-js'}
          url={url}
          webpreferences={disableHtmlPreviewJs ? 'javascript=no' : 'javascript=yes'}
        />
      );
    } else if (previewMode === PREVIEW_MODE_FRIENDLY && ct.indexOf('application/pdf') === 0) {
      return (
        <div className="tall wide scrollable">
          <PDFViewer body={bodyBuffer} uniqueKey={responseId} />
        </div>
      );
    } else if (previewMode === PREVIEW_MODE_FRIENDLY && ct.indexOf('text/csv') === 0) {
      return (
        <div className="tall wide scrollable">
          <CSVViewer body={bodyBuffer} key={responseId} />
        </div>
      );
    } else if (previewMode === PREVIEW_MODE_FRIENDLY && ct.indexOf('multipart/') === 0) {
      return (
        <MultipartViewer
          bodyBuffer={bodyBuffer}
          contentType={contentType}
          disableHtmlPreviewJs={disableHtmlPreviewJs}
          disablePreviewLinks={disablePreviewLinks}
          download={download}
          editorFontSize={editorFontSize}
          editorIndentSize={editorIndentSize}
          editorKeyMap={editorKeyMap}
          editorLineWrapping={editorLineWrapping}
          filter={filter}
          filterHistory={filterHistory}
          key={responseId}
          responseId={responseId}
          url={url}
        />
      );
    } else if (previewMode === PREVIEW_MODE_FRIENDLY && ct.indexOf('audio/') === 0) {
      const justContentType = contentType.split(';')[0];
      const base64Body = bodyBuffer.toString('base64');
      return (
        <div className="vertically-center" key={responseId}>
          <audio controls>
            <source src={`data:${justContentType};base64,${base64Body}`} />
          </audio>
        </div>
      );
    } else if (previewMode === PREVIEW_MODE_RAW) {
      const match = contentType.match(/charset=([\w-]+)/);
      const charset = match && match.length >= 2 ? match[1] : 'utf-8';
      return (
        <ResponseRaw
          key={responseId}
          responseId={responseId}
          ref={this._setSelectableViewRef}
          value={this._decodeIconv(bodyBuffer, charset)}
          fontSize={editorFontSize}
        />
      );
    } else {
      // Show everything else as "source"
      const match = contentType.match(/charset=([\w-]+)/);
      const charset = match && match.length >= 2 ? match[1] : 'utf-8';

      // Sometimes iconv conversion fails so fallback to regular buffer
      const body = this._decodeIconv(bodyBuffer, charset);

      // Try to detect content-types if there isn't one
      let mode;

      if (!mode && body.match(/^\s*<\?xml [^?]*\?>/)) {
        mode = 'application/xml';
      } else {
        mode = contentType;
      }

      return (
        <CodeEditor
          key={disablePreviewLinks ? 'links-no' : 'links-yes'}
          ref={this._setSelectableViewRef}
          autoPrettify
          defaultValue={body}
          filter={filter}
          filterHistory={filterHistory}
          fontSize={editorFontSize}
          indentSize={editorIndentSize}
          keyMap={editorKeyMap}
          lineWrapping={editorLineWrapping}
          mode={mode}
          noMatchBrackets
          onClickLink={disablePreviewLinks ? undefined : clickLink}
          placeholder="..."
          readOnly
          uniquenessKey={responseId}
          updateFilter={updateFilter}
        />
      );
    }
  }

  render() {
    return <KeydownBinder onKeydown={this._handleKeyDown}>{this._renderView()}</KeydownBinder>;
  }
}

export default ResponseViewer;
