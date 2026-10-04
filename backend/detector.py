import cv2
import numpy as np
from ultralytics import YOLOWorld

class YoloWorldDetector:
    def __init__(self):
        # intializing the modle here
        # using the small model so it doesnt take much space
        self.model = YOLOWorld('yolov8s-world.pt')
        
    def detect_objects_in_file(self, file_path, custom_classes_str):
        # read image using opencv
        img = cv2.imread(file_path)
        if img is None:
            # return empty if cant read image
            return []
            
        # parse the classes string to a list
        if custom_classes_str and custom_classes_str.strip() != "":
            # split by comma and remove spaces
            classes = [c.strip() for c in custom_classes_str.split(',')]
            # set custom classes to modle
            self.model.set_classes(classes)
        
        # getting predicitons without printing lot of logs
        results = self.model.predict(img, verbose=False)
        
        detections = []
        # loop for all results
        for r in results:
            boxes = r.boxes
            for box in boxes:
                # get cords
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf[0])
                cls = int(box.cls[0])
                
                # checking if conf is somewhat decent
                if conf > 0.05:
                    # add to array
                    detections.append({
                        "box": [x1, y1, x2, y2],
                        "confidence": conf,
                        "class_name": self.model.names[cls]
                    })
                
        return detections
