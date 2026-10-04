import { useState, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

function App() {
  const [inputFolder, setInputFolder] = useState<string>("");
  const [outputFolder, setOutputFolder] = useState<string>("");
  const [customClasses, setCustomClasses] = useState<string>("person, car, dog");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  
  // new states for the progress, console, cooldown, and max count
  const [imageCount, setImageCount] = useState<number | null>(null);
  const [maxProcessCount, setMaxProcessCount] = useState<number>(100);
  const [isCoolingDown, setIsCoolingDown] = useState<boolean>(false);
  
  const [currentFile, setCurrentFile] = useState<string>("");
  const [progress, setProgress] = useState<{current: number, total: number}>({current: 0, total: 0});
  const [logs, setLogs] = useState<string[]>([]);
  
  const consoleRef = useRef<HTMLDivElement>(null);

  // auto scroll console to bottom
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  const select_input_folder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        setInputFolder(selected);
        // show that msg like image count
        fetch("http://localhost:8000/scan_folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input_folder: selected })
        })
        .then(res => res.json())
        .then(data => {
          setImageCount(data.count);
        })
        .catch(err => console.error(err));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const select_output_folder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        setOutputFolder(selected);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const process_images = async (force: boolean = false) => {
    if (!inputFolder || !outputFolder) {
      alert("please select both input and output folders first");
      return;
    }
    
    setIsLoading(true);
    setStatusMsg("Starting process...");
    setLogs([]);
    setProgress({current: 0, total: 0});
    setCurrentFile("");
    
    const startTime = Date.now();
    
    try {
      const res = await fetch("http://localhost:8000/process_folder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input_folder: inputFolder,
          output_folder: outputFolder,
          custom_classes: customClasses,
          force: force,
          max_process_count: maxProcessCount
        }),
      });
      
      const contentType = res.headers.get("content-type");
      
      // if it's a normal json response (like error or confirmation)
      if (contentType && contentType.includes("application/json")) {
        const data = await res.json();
        if (data.status === "needs_confirmation") {
          // if user say yes the python will copy it
          const proceed = window.confirm(data.message);
          if (proceed) {
            // call it again with force true
            await process_images(true);
          } else {
            setStatusMsg("Cancelled by user.");
            setIsLoading(false);
          }
        } else if (data.status === "error") {
          alert(data.message);
          setStatusMsg("Error: " + data.message);
          setIsLoading(false);
        }
        return;
      }
      
      // if it's streaming response
      const reader = res.body?.getReader();
      if (!reader) {
        setIsLoading(false);
        return;
      }
      
      const decoder = new TextDecoder();
      let buffer = "";
      setStatusMsg("Processing...");
      
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ""; // keep incomplete line
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            
            if (evt.type === "start") {
              setProgress(p => ({...p, total: evt.total}));
            } else if (evt.type === "progress") {
              setProgress(p => ({...p, current: evt.current}));
              setCurrentFile(evt.filename);
            } else if (evt.type === "log") {
              setLogs(prev => [...prev, evt.msg]);
            } else if (evt.type === "error") {
              alert(evt.message);
              setStatusMsg("Error: " + evt.message);
              setIsLoading(false);
            } else if (evt.type === "done") {
              const elapsedSecs = ((Date.now() - startTime) / 1000).toFixed(1);
              setStatusMsg(`Success! Finished processing in ${elapsedSecs}s. Copied ${evt.copied} images.`);
              setIsLoading(false);
              
              // Give a cool down between one complete process
              setIsCoolingDown(true);
              setTimeout(() => {
                setIsCoolingDown(false);
                
                // clean app once again as requested
                setInputFolder("");
                setOutputFolder("");
                setImageCount(null);
                setMaxProcessCount(100);
                setLogs([]);
                setProgress({current: 0, total: 0});
                setCurrentFile("");
                setStatusMsg("");
              }, 4000); // 4 seconds cooldown to let user read the success message before wiping
            }
          } catch(e) {
            console.error("json parse error on line", line, e);
          }
        }
      }
      
    } catch (err) {
      console.error(err);
      alert("somthing went wrong with the server. is python running?");
      setStatusMsg("Server connection failed.");
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>YOLO-World Batch Image Processor</h1>
      <p>A B.Tech project to sort out images using open vocabulary detection</p>
      
      <div className="controls">
        <div className="input-group">
          <label>Input Folder:</label>
          <div className="folder-row">
            <button className="folder-btn" onClick={select_input_folder}>Select Input Folder</button>
            <span className="folder-path">{inputFolder || "No folder selected"}</span>
          </div>
          {/* if images are more than 100 show that msg */}
          {imageCount !== null && (
            <div className={`count-msg ${imageCount > 100 ? 'warning' : ''}`}>
              Found {imageCount} images in total.
              {imageCount > 100 && (
                <div className="custom-count-box">
                  <label>Max images to process:</label>
                  <input 
                    type="number" 
                    className="count-input"
                    value={maxProcessCount} 
                    onChange={(e) => setMaxProcessCount(Number(e.target.value))} 
                    max={imageCount}
                    min={1}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        
        <div className="input-group">
          <label>Output Folder:</label>
          <div className="folder-row">
            <button className="folder-btn" onClick={select_output_folder}>Select Output Folder</button>
            <span className="folder-path">{outputFolder || "No folder selected"}</span>
          </div>
        </div>
        
        <div className="input-group">
          <label>Find and filter by these classes (comma separated):</label>
          <input 
            type="text" 
            value={customClasses} 
            onChange={(e) => setCustomClasses(e.target.value)} 
            placeholder="e.g. dog, cat, car"
          />
        </div>
        
        <button 
          className="main-btn" 
          onClick={() => process_images(false)} 
          disabled={isLoading || isCoolingDown || !inputFolder || !outputFolder}
        >
          {isLoading ? "Processing..." : isCoolingDown ? "Cooling down..." : "Find and Copy Images"}
        </button>
      </div>
      
      <div className="display-area">
        <div className="status-container">
           <div className="status-title">{statusMsg || "Ready to process images!"}</div>
           
           {/* the bottom panes shold show which image is in the process and progress bar */}
           {progress.total > 0 && (
             <div className="progress-section">
               <div className="progress-text">
                 Processing: {currentFile} ({progress.current}/{progress.total})
               </div>
               <div className="progress-bar-bg">
                 <div 
                   className="progress-bar-fill" 
                   style={{width: `${(progress.current / progress.total) * 100}%`}}
                 ></div>
               </div>
             </div>
           )}
           
           {/* expandable console like thing */}
           <div className="console-panel" ref={consoleRef}>
             {logs.length === 0 ? (
               <div className="console-empty">Logs will appear here...</div>
             ) : (
               logs.map((log, idx) => (
                 <div key={idx} className={`console-line ${log.includes('[+]') ? 'match' : log.includes('[~]') ? 'skip' : ''}`}>
                   {log}
                 </div>
               ))
             )}
           </div>
        </div>
      </div>
    </div>
  );
}

export default App;
