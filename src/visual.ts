// TODO: Clear all selections. Currently it does not work to first make a selection and then crossfilter by another bisual. The selection is still there (not reset). Probably a bug in the framework?

module powerbi.extensibility.visual {
    interface VisualViewModel {
        dataPoints: VisualDataPoint[];
        settings: VisualSettings;
    };

    interface VisualDataPoint {
        imageURL: string;
        imageURLHQ: string;
        value: number;
        selectionId: ISelectionId;
    };

    interface VisualSettings {
        settings: {
            maximumColumns: number;
            minimumHQWidth: number;
            renderRype: string;
            topListWeight: number;
        };
    }

    function getMeasureIndex(dv: DataViewCategorical, measureName: string): number {
        let RetValue: number = -1;
        for (let i = 0; i < dv.values.length; i++) {
            if (dv.values[i].source.roles[measureName] === true) {
                RetValue = i;
                break;
            }
        }
        return RetValue;
    }

    function getColumnIndex(md: DataViewMetadata, columnName: string): number {
        let RetValue: number = -1;
        for (let i = 0; i < md.columns.length; i++) {
            if (md.columns[i].roles[columnName] === true) {
                RetValue = i;
                break;
            }
        }
        return RetValue;
    }

    function visualTransform(options: VisualUpdateOptions, host: IVisualHost, thisRef: Visual): VisualViewModel {
        let dataViews = options.dataViews;
        let defaultSettings: VisualSettings = {
            settings: {
                maximumColumns: 4,
                minimumHQWidth: 200,
                renderRype: "CIRCLETOPLIST",
                topListWeight: 1
            }
        }; 
        let viewModel: VisualViewModel = {
            dataPoints: [],
            settings: <VisualSettings>{}
        };

        if (!dataViews
            || !dataViews[0]
            || !dataViews[0].categorical
            || !dataViews[0].categorical.categories
            || !dataViews[0].categorical.categories[0].source
            )
            return viewModel;

        let category = dataViews[0].categorical.categories[0];
        let objects = dataViews[0].metadata.objects;
        let visualSettings: VisualSettings = {
            settings: {
                maximumColumns: getValue<number>(objects, 'settings', 'pMaxColumns', defaultSettings.settings.maximumColumns),
                minimumHQWidth: getValue<number>(objects, 'settings', 'pHQMinWidth', defaultSettings.settings.minimumHQWidth),
                renderRype: getValue<string>(objects, 'settings', 'pRenderType', defaultSettings.settings.renderRype),
                topListWeight: getValue<number>(objects, 'settings', 'pTopListWeight', defaultSettings.settings.topListWeight),
            }
        }

        let ValueIndex = getColumnIndex(dataViews[0].metadata, "Value");
        let ImageURLLQIndex = getColumnIndex(dataViews[0].metadata, "ImageURL");
        let ImageURLHQIndex = getColumnIndex(dataViews[0].metadata, "ImageURLHQ");

        if ( ImageURLLQIndex === -1 && ImageURLHQIndex === -1 ) {
            return viewModel;
        }

        var selectionIDs = thisRef.getSelectionIds(dataViews[0], host);      

        let visualDataPoints: VisualDataPoint[] = [];
        for( var i = 0; i < dataViews[0].table.rows.length; i++) {
            var row = dataViews[0].table.rows[i];
            var lqImage = ImageURLLQIndex > -1 ? <string>row[ImageURLLQIndex] : ImageURLHQIndex > -1 ? <string>row[ImageURLHQIndex] : "";
            var hqImage = ImageURLHQIndex > -1 ? <string>row[ImageURLHQIndex] : ImageURLLQIndex > -1 ? <string>row[ImageURLLQIndex] : "";
            var value = ValueIndex > -1 ? <number>row[ValueIndex] : null;
            visualDataPoints.push({
                value: value,
                imageURL: lqImage,
                imageURLHQ: hqImage,
                selectionId: selectionIDs[i]
                //selectionId: host.createSelectionIdBuilder().withCategory(dataViews[0].categorical.categories[0], i).createSelectionId()
            });
        }
        
        return {
            dataPoints: visualDataPoints,
            settings: visualSettings
        };
    }

    export class Visual implements IVisual {
        private host: IVisualHost;
        private updateCount: number;

        private svg: d3.Selection<SVGElement>;

        private visualCurrentSettings: VisualSettings;
        private visualDataPoints: VisualDataPoint[];
        private selectionManager: ISelectionManager;
        private currentGridImageWidth = 0;

        constructor(options: VisualConstructorOptions) {
            this.host = options.host;
            this.selectionManager = options.host.createSelectionManager();
            let svg = this.svg = d3.select(options.element)
                .append('svg')
                .classed('imageGrid', true);
            options.element.style.overflowY = "auto";
        }

        public drawPackedCircles(dataList:any, pack:any, maxWidthForLowres:number) {
            var s = this.svg.data([dataList]).selectAll(".myImages")
            .data(pack.nodes);

            let selectionManager = this.selectionManager;
            let allowInteractions = this.host.allowInteractions;

            var activeSelections:any = selectionManager.getSelectionIds();

            s.enter().append("svg:image").classed("myImages", true);
            s.exit().remove();

            s.attr("xlink:href", function (d:any) {
                return d.r*2 > maxWidthForLowres ? d.imageURLHQ : d.imageURLLQ; 
            });
            s.transition()
            .attr("x", function (d:any) { return d.x-d.r; })
            .attr("y", function (d:any) { return d.y-d.r; })
            .attr("width", function (d:any) { return d.r*2; })
            .attr("height", function (d:any) { return d.r*2; })
            .attr("opacity", function (d:any) {
                if ( typeof d.selectionId === 'undefined') { // Första cirkeln är själva pack-cirkeln. Ignorera denna.
                    return 0.0;
                }
                if (activeSelections.length <= 0) {
                    return 1.0; // Om vi inte har några valda
                }
                for (var i = 0; i < activeSelections.length; i++) {
                    if (d.selectionId.key == activeSelections[i].key) {
                        return 1.0; // Den som är aktivt vald
                    }
                }
                return 0.5; // Alla som inte är valda 
            })
            ;
            this.addClickEvent(s);       
        }

        // Weighted Circle
        public updatePackedLayout(options: VisualUpdateOptions) {
            let width = options.viewport.width;
            let height = options.viewport.height;

            let MaxCols = this.visualCurrentSettings.settings.maximumColumns;
            var MAXWIDTHFORLOWRES = this.visualCurrentSettings.settings.minimumHQWidth;

            this.svg
                .attr("width", width)
                .attr("height", height-10);

            // Transform to packed preferred array
            var dataList = {children:[]};
            var minValue = d3.min(this.visualDataPoints, function(d) {return d.value;});
            var maxAbsValue = Math.abs( d3.max(this.visualDataPoints, function(d) {return d.value;}) );
            for( var i=0;i<this.visualDataPoints.length; i++) {
                var p = this.visualDataPoints[i];
                // TODO: Om value är mindre än noll... normalisera...
                dataList.children.push( {
                    value: p.value === null ? 1 : (p.value - minValue + (maxAbsValue*0.1) + 1),
                    imageURLLQ: p.imageURL,
                    imageURLHQ: p.imageURLHQ,
                    selectionId : p.selectionId,
                } );
            }
            
            var pack = d3.layout.pack()
                .sort(d3.descending)
                .value(function(d) { return d.value;})
                .size([width, height]);
            
            this.drawPackedCircles(dataList, pack, MAXWIDTHFORLOWRES);
        }

        

        // Circle Top List
        public updatePackedLayoutTopList(options: VisualUpdateOptions) {
            let width = options.viewport.width;
            let height = options.viewport.height;

            let MaxCols = this.visualCurrentSettings.settings.maximumColumns;
            var MAXWIDTHFORLOWRES = this.visualCurrentSettings.settings.minimumHQWidth;

            this.svg
                .attr("width", width)
                .attr("height", height-10);

            // Transform to packed preferred array
            var dataList = {children:[]};
            for( var i=0;i<this.visualDataPoints.length; i++) {
                var p = this.visualDataPoints[i];
                // TODO: Om value är mindre än noll... normalisera...
                dataList.children.push( {
                    value : i==0 ? this.visualDataPoints.length*this.visualDataPoints.length*this.visualCurrentSettings.settings.topListWeight*0.1 : (this.visualDataPoints.length-i),
                    imageURLLQ: p.imageURL,
                    imageURLHQ: p.imageURLHQ,
                    selectionId : p.selectionId,
                } );
            }
            
            var pack = d3.layout.pack()
                .sort(d3.descending)
                .value(function(d) { return d.value;})
                .size([width, height]);
            
            this.drawPackedCircles(dataList, pack, MAXWIDTHFORLOWRES);
        }
        
        // Grid
        public updateGridLayout(options: VisualUpdateOptions) {
            let selMag = this.selectionManager;
            let width = options.viewport.width;
            let height = options.viewport.height;
            
            let MaxCols = this.visualCurrentSettings.settings.maximumColumns;
            var MAXWIDTHFORLOWRES = this.visualCurrentSettings.settings.minimumHQWidth;

            var lineData = [];
            var Cols;
            for (Cols = 1; Cols <= MaxCols; Cols++) {
                var iw = width / Cols;
                var ih = iw;
                var NoRows = Math.ceil(this.visualDataPoints.length / Cols);
                if ((NoRows * ih) < height) {
                    break;
                }
            }

            if (Cols < 1)
                Cols = 1;
            if (Cols > MaxCols)
                Cols = MaxCols;

            var imgWidth = width / Cols;
            var maxRow = 0;
            for (var i = 0; i < this.visualDataPoints.length; i++) {
                var Col = i % Cols;
                var Row = (i - Col) / Cols;
                if (Row > maxRow)
                    maxRow = Row;
                lineData.push({
                    index: i,
                    x: imgWidth * Col,
                    y: imgWidth * Row,
                    category: imgWidth > MAXWIDTHFORLOWRES ? this.visualDataPoints[i].imageURLHQ : this.visualDataPoints[i].imageURL,
                    selectionId: this.visualDataPoints[i].selectionId
                });
            }

            var totalHeight = (maxRow +1)* imgWidth;

            this.svg
                .attr("width", width)
                .attr("height", totalHeight);

            var s = this.svg.selectAll(".myImages").data(lineData);

            s.enter().append("svg:image").classed("myImages", true);
            s.exit().remove();

            s.attr("xlink:href", function (d) { return d.category; });

            var activeSelections:any = selMag.getSelectionIds();

            this.currentGridImageWidth = imgWidth;

            s.transition()
                .attr("x", function (d) { return d.x; })
                .attr("y", function (d) { return d.y; })
                .attr("width", function (d) { return imgWidth; })
                .attr("height", function (d) { return imgWidth; })
                .attr("opacity", function (d:any) {
                    if (activeSelections.length <= 0) {
                        return 1.0; // Om vi inte har några valda
                    }
                    for (var i = 0; i < activeSelections.length; i++) {
                        if (d.selectionId.key == activeSelections[i].key) {
                            return 1.0; // Den som är aktivt vald
                        }
                    }
                    return 0.5; // Alla som inte är valda
                })
                ;

            this.addClickEvent(s);
        }

        public addClickEvent(selection:any) {
            let selectionManager = this.selectionManager;
            let allowInteractions = this.host.allowInteractions;

            var thisRef = this;

            if ( this.visualCurrentSettings.settings.renderRype === "GRID" ) {
                selection.on("mouseover", function(d,i) {
                    d3.select(this).transition()
                        .attr("x", function (d) { return d.x-thisRef.currentGridImageWidth*0.1; })
                        .attr("y", function (d) { return d.y-thisRef.currentGridImageWidth*0.1; })
                        .attr("width", function (d) { return thisRef.currentGridImageWidth*1.2; })
                        .attr("height", function (d) { return thisRef.currentGridImageWidth*1.2; })
                        ;
                });
                selection.on("mouseout", function(d,i) {
                    d3.select(this).transition()
                        .attr("x", function (d) { return d.x; })
                        .attr("y", function (d) { return d.y; })
                        .attr("width", function (d) { return thisRef.currentGridImageWidth; })
                        .attr("height", function (d) { return thisRef.currentGridImageWidth; })
                        ;
                });

            } else {
                selection.on("mouseover", function(d,i) {
                    d3.select(this).transition()
                        .attr("x", function (d:any) { return d.x-d.r*1.4; })
                        .attr("y", function (d:any) { return d.y-d.r*1.4; })
                        .attr("width", function(d) {return d.r*2.8;})
                        .attr("height", function(d) {return d.r*2.8;})
                        ;
                });
                selection.on("mouseout", function(d,i) {
                    d3.select(this).transition()
                        .attr("x", function (d:any) { return d.x-d.r; })
                        .attr("y", function (d:any) { return d.y-d.r; })
                        .attr("width", function(d) {return d.r*2;})
                        .attr("height", function(d) {return d.r*2;})
                        ;
                });
            }


            selection.on('click', function (d) {
                if ( allowInteractions ) {
                    selectionManager.select(d.selectionId).then((ids: ISelectionId[]) => {
                        selection.attr({
                            'opacity': ids.length > 0 ? 0.5 : 1.0
                        });
                        d3.select(this).attr({
                            'opacity': 1.0
                        }); 
                        
                    });
                    (<Event>d3.event).stopPropagation();
                }
            });
        }
       
        public update(options: VisualUpdateOptions) {

            let viewModel: VisualViewModel = visualTransform(options, this.host, this);
            let settings = this.visualCurrentSettings = viewModel.settings;
            this.visualDataPoints = viewModel.dataPoints;

            let width = options.viewport.width;
            let height = options.viewport.height;

            if (this.visualDataPoints.length === 0) {
                this.svg.attr("visibility", "hidden");
                return;
            }
            this.svg.attr("visibility", "visible");

            switch( this.visualCurrentSettings.settings.renderRype) {
                case "GRID":
                    this.updateGridLayout(options);
                    break;
                case "CIRCLE":
                    this.updatePackedLayout(options);
                    break;
                case "CIRCLETOPLIST":
                    this.updatePackedLayoutTopList(options);
                    break;
                default:
                    break;
            }

        }

        public getSelectionIds(dataView: DataView, host: IVisualHost): ISelectionId[] {
            if ( typeof(dataView.table.identity) === "undefined" ) {
                return null;
            }
            return dataView.table.identity.map((identity: DataViewScopeIdentity) => {
                const categoryColumn: DataViewCategoryColumn = {
                    source: dataView.table.columns[0],
                    values: null,
                    identity: [identity]
                };
        
                return host.createSelectionIdBuilder()
                    .withCategory(categoryColumn, 0)
                    .createSelectionId();
            });
        }

        // Right settings panel
        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstanceEnumeration {
            let objectName = options.objectName;
            let objectEnumeration: VisualObjectInstance[] = [];
            
            switch (objectName) {
                case 'settings':
                    objectEnumeration.push({
                        objectName: objectName,
                        displayName: "Settings",
                        properties: {
                            pMaxColumns: this.visualCurrentSettings.settings.maximumColumns,
                            pHQMinWidth: this.visualCurrentSettings.settings.minimumHQWidth,
                            pTopListWeight: this.visualCurrentSettings.settings.topListWeight,
                            pRenderType:this.visualCurrentSettings.settings.renderRype,
                        },
                        selector: null
                    });
                    break;
                
            };

            return objectEnumeration;
        }

        public destroy(): void {
            //TODO: Perform any cleanup tasks here
        }
    }
}