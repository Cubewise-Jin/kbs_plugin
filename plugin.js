
// Uncomment the code arc.run.. below to enable this plugin


arc.run(['$rootScope', function ($rootScope) {

    $rootScope.plugin("arcTemplate", "Template Title", "page", {
        menu: "tools",
        icon: "fa-paw",
        description: "This plugin can be used as a starting point for building new page plugins",
        author: "Cubewise",
        url: "https://github.com/cubewise-code/arc-plugins",
        version: "1.0.0"
    });

}]);


arc.directive("arcTemplate", function () {
    return {
        restrict: "EA",
        replace: true,
        scope: {
            instance: "=tm1Instance"
        },
        templateUrl: "__/plugins/template-page/template.html",
        link: function ($scope, element, attrs) {

        },
        controller: ["$scope", "$rootScope", "$http", "$tm1", "$translate", "$timeout", function ($scope, $rootScope, $http, $tm1, $translate, $timeout) {

            // === Constants ===
            const FIXED_INSTANCE = "c000_kbs";
            const CUBE_NAME = "Sys Documentation"; 
            const DIM_TM1_OBJECT_TYPE = "TM1 Object Type"
            const DIM_INSTANCE = "Instance";     
            const DIM_TM1_OBJECT = "TM1 Object";
            const DIM_UPDATE_RECORD = "Update Record";
            const DIM_M_SYS_DOCUMENTATION = "M Sys Documentation"
            const ELEM_UPDATE = "Update Input";

            const M_SYS_DOCUMENTATION_KEYS = [
              "Requirement",
              "How to Use",
              "Maintenance",
              "Relevant Biz Process",
              "Additional Information",
              "User Interface",
              "Managers Sign Off"
            ];
          
            // === Data holders ===
            $scope.values = { 
                loading: false,
                error: null,
                user_interface_options: [],
                tree_data: [],
                selected_tm1_object: null,
                selected_tm1_object_id: null,
                updates: {},
                updatesMeta: {},
                form: {},
                formOriginal: {},
                sign_off_options: [
                  { label: "Y", value: "1" },
                  { label: "N", value: "" }
                ]
            };

            $scope.selections = { 
              user_interface: null 
            };  

            // === Utils ===
            function emptyInfo() {
              return M_SYS_DOCUMENTATION_KEYS.reduce((acc, k) => ((acc[k] = ""), acc), {});
            }

            function valOf(cell) {
              return cell?.FormattedValue ?? cell?.Text ?? cell?.Value ?? "";
            }

            function findNodeByInstanceAndObject(instance, tm1Object) {
              const pack = ($scope.values.tree_data || []).find(x => x.instance === instance);
              if (!pack) return null;
            
              function dfs(list) {
                for (const n of (list || [])) {
                  if (n.tm1_object === tm1Object) return n;
                  const hit = dfs(n.nodes);
                  if (hit) return hit;
                }
                return null;
              }
              return dfs(pack.tm1_objects);
            }


            function esc(s) { return String(s || "").replace(/'/g, "''"); }
            function normalizeSignOff(v){ return (v==="1"||v===1||v===true||v==="Y")?"1":""; }
            function toStoredValue(measure, val){
              return (measure === "Managers Sign Off") ? normalizeSignOff(val) : (val == null ? "" : String(val));
            }
            
            function buildUpdatePayloadsFromUpdates() {
              const uiType = $scope.selections.user_interface;
              if (!uiType) return [];
            
              const updates = $scope.values.updates || {};
              const payload = [];
            
              Object.keys(updates).forEach(function (inst) {
                const perObj = updates[inst] || {};
            
                Object.keys(perObj).forEach(function (obj) {
                  const perMeasure = perObj[obj] || {};
            
                  Object.keys(perMeasure).forEach(function (measure) {
                    const rawVal = perMeasure[measure];
                    const value = toStoredValue(measure, rawVal);
            
                    payload.push({
                      "Cells": [
                        {
                          "Tuple@odata.bind": [
                            "Dimensions('Instance')/Hierarchies('Instance')/Elements('" + esc(inst) + "')",
                            "Dimensions('TM1 Object Type')/Hierarchies('TM1 Object Type')/Elements('" + esc(uiType) + "')",
                            "Dimensions('TM1 Object')/Hierarchies('TM1 Object')/Elements('" + esc(obj) + "')",
                            "Dimensions('Update Record')/Hierarchies('Update Record')/Elements('" + esc(ELEM_UPDATE) + "')",
                            "Dimensions('M Sys Documentation')/Hierarchies('M Sys Documentation')/Elements('" + esc(measure) + "')"
                          ]
                        }
                      ],
                      "Value": value
                    });
                  });
                });
              });
            
              return payload;
            }

            // === Load elements from a dimension ===
            $scope.loadElements = function (dim, container) {
                $scope.values.loading = true;
                $scope.values.error = null;
        
                const restPath = `/Dimensions('${dim}')/Hierarchies('${dim}')/Elements?$select=Name`;
                $tm1.async(FIXED_INSTANCE, 'GET', restPath)
                .then(function (resp) {
                    const list =  resp?.data?.value || [];
                    $scope.values[container] = list;

                    // default
                    if (container === 'user_interface_options' && list.length) {
                      $scope.selections.user_interface = list[0].Name;
                      $timeout($scope.onUIChange, 0);
                    }
                })
                .catch(function (err) {
                    $scope.values.error =
                    err?.data?.error?.message || err?.statusText || "Connection failed";
                })
                .finally(function () {
                    $scope.values.loading = false;
                });
            };

            $scope.loadElements(DIM_TM1_OBJECT_TYPE, 'user_interface_options');

            // === Load TM1 object hierarchy edges ===
            function fetchEdges() {
              const url = `/Dimensions('${DIM_TM1_OBJECT}')/Hierarchies('${DIM_TM1_OBJECT}')/Edges?$select=ParentName,ComponentName,Weight`;
              return $tm1.async(FIXED_INSTANCE, "GET", url).then((resp) => {
                const rows = resp?.data?.value || [];
                const childrenByParent = {};
                const allNodes = new Set();

                rows.forEach((e) => {
                  const parent = e.ParentName;
                  const child = e.ComponentName;
                  allNodes.add(parent);
                  allNodes.add(child);
                  if (!childrenByParent[parent]) childrenByParent[parent] = [];
                  childrenByParent[parent].push(child);
                });

                return { childrenByParent, allNodes };
              });
            }

            // === Build nested tree from edges ===
            function buildTreeFromEdges(edges) {
              const { childrenByParent, allNodes } = edges;
              const allChildren = new Set(
                [].concat(...Object.values(childrenByParent))
              );
              const roots = Array.from(allNodes).filter(
                (n) => !allChildren.has(n)
              );
    
              const build = (name) => ({
                tm1_object: name,
                nodes: (childrenByParent[name] || []).map((child) => build(child))
              });
    
              return roots.map((r) => build(r));
            }

            // Merge info + expanded flags into tree
            function mergeTree(nodes, getInfo, instance = null, level = 0, path = []) {
              return nodes.map((node, idx) => {
                const currentPath = path.concat(node.tm1_object || String(idx));
                const _id = instance
                  ? [instance].concat(currentPath).join("/")
                  : currentPath.join("/");
            
                return {
                  _id,
                  tm1_object: node.tm1_object,
                  info: getInfo(node.tm1_object) || emptyInfo(),
                  expanded: false,
                  nodes: mergeTree(node.nodes || [], getInfo, instance, level + 1, currentPath)
                };
              });
            }

            // === Run MDX and expand ===
            function executeMDXExpanded(mdx) {
              const url =
                "/ExecuteMDX?" +
                "$expand=" +
                "Axes($expand=Tuples($expand=Members($select=Name,UniqueName)))," +
                "Cells($select=Ordinal,Value,FormattedValue)";
    
              return $tm1.async(FIXED_INSTANCE, "POST", url, { MDX: mdx })
                .then((resp) => {
                  
                  if (resp?.status === 200 && resp?.data?.Axes) {
                    return resp.data;
                  }
    
                  if (resp?.status === 201 && resp?.data?.ID) {
                    const id = resp.data.ID;
                    const getUrl =
                      `/Cellsets('${id}')?` +
                      `$expand=Axes($expand=Tuples($expand=Members($select=Name,UniqueName))),` +
                      `Cells($select=Ordinal,Value,FormattedValue)`;
    
                    return $tm1.async(FIXED_INSTANCE, "GET", getUrl)
                      .then((res2) => res2?.data)
                      .finally(() => {
                        $tm1.async(FIXED_INSTANCE, "DELETE", `/Cellsets('${id}')`);
                      });
                  }
    
                  throw new Error("ExecuteMDX did not return Axes/Cells nor ID");
                });
            }

            // === Fetch documentation cube values ===
            function fetchDocCells(uiType) {
              const mdx = `
                SELECT
                  CrossJoin(
                    [${DIM_INSTANCE}].[${DIM_INSTANCE}].Members,
                    TM1SubsetToSet([${DIM_M_SYS_DOCUMENTATION}].[${DIM_M_SYS_DOCUMENTATION}], "zJC_spa")
                  ) ON COLUMNS,
                  { TM1DRILLDOWNMEMBER({[${DIM_TM1_OBJECT}].[${DIM_TM1_OBJECT}].Members}, ALL, RECURSIVE) } ON ROWS
                FROM [${CUBE_NAME}]
                WHERE (
                  [${DIM_TM1_OBJECT_TYPE}].[${DIM_TM1_OBJECT_TYPE}].[${uiType}],
                  [${DIM_UPDATE_RECORD}].[${DIM_UPDATE_RECORD}].[${ELEM_UPDATE}]
                )
              `;
    
              return executeMDXExpanded(mdx).then((data) => {
                const axes = data?.Axes || [];
                const cells = data?.Cells || [];
                const rowsTuples = axes[1]?.Tuples || [];
                const colsTuples = axes[0]?.Tuples || [];
    
                const rowObjNames = rowsTuples.map(t => t.Members[0].Name);
    
                const colSlots = colsTuples.map(t => {
                  const members = t.Members || [];
                  let instance = null;
                  let colName = null;
    
                  members.forEach(m => {
                    const uq = m.UniqueName || "";
                    if (uq.indexOf(`[${DIM_INSTANCE}]`) >= 0) instance = m.Name;
                    else if (uq.indexOf(`[${DIM_M_SYS_DOCUMENTATION}]`) >= 0) colName = m.Name;
                    else {
                    }
                  });
                  
                  return { instance, colName };
                });
    
                const instances = Array.from(new Set(colSlots.map(c => c.instance).filter(Boolean)));
                const cellMap = {};
                const colCount = colSlots.length;
  
                rowObjNames.forEach((objName, r) => {
                  colSlots.forEach((slot, c) => {
                    const cell = cells[r * colCount + c];
                    if (!slot?.instance) return; 
                    const key = `${slot.instance}|${objName}`;
                    if (!cellMap[key]) cellMap[key] = emptyInfo();
    
                    if (slot.colName && M_SYS_DOCUMENTATION_KEYS.includes(slot.colName)) {
                      cellMap[key][slot.colName] = String(valOf(cell));
                    }
                  });
                });
    
                return { instances, cellMap };
              });
            }

            // Load Tree 
            $scope.loadInstanceObjectTree = function () {
              const uiType = $scope.selections.user_interface;
              if (!uiType) return;
    
              $scope.values.loading = true;
              Promise.all([fetchEdges(), fetchDocCells(uiType)])
                .then(([edges, doc]) => {
                  const baseTree = buildTreeFromEdges(edges);

                  $scope.values.tree_data = doc.instances.map((inst) => ({
                    instance: inst,
                    expanded: true,
                    tm1_objects: mergeTree(baseTree, (o) => doc.cellMap[`${inst}|${o}`], inst),
                  }));
                })
                .catch((err) => {
                  $scope.values.error = err?.data?.error?.message || err?.statusText || "Load failed";
                })
                .finally(() => {
                  $scope.values.loading = false;
                  $scope.$applyAsync();
                });
            };

            // 
            function ensureUpdatesBucket(instance, obj) {
              if (!$scope.values.updates[instance]) $scope.values.updates[instance] = {};
              if (!$scope.values.updates[instance][obj]) $scope.values.updates[instance][obj] = {};
              return $scope.values.updates[instance][obj];
            }

            function ensureUpdatesMetaWithOriginal(instance, obj, originalInfo) {
              if (!$scope.values.updatesMeta[instance]) $scope.values.updatesMeta[instance] = {};
              if (!$scope.values.updatesMeta[instance][obj]) {
                $scope.values.updatesMeta[instance][obj] = { original: angular.copy(originalInfo || {}) };
              }
              return $scope.values.updatesMeta[instance][obj];
            }

            function cleanupUpdatesBucketIfEmpty(instance, obj) {
              const box = $scope.values.updates[instance]?.[obj];
              if (box && Object.keys(box).length === 0) {
                delete $scope.values.updates[instance][obj];
                if (Object.keys($scope.values.updates[instance]).length === 0) {
                  delete $scope.values.updates[instance];
                }
                if ($scope.values.updatesMeta[instance]?.[obj]) {
                  delete $scope.values.updatesMeta[instance][obj];
                  if (Object.keys($scope.values.updatesMeta[instance]).length === 0) {
                    delete $scope.values.updatesMeta[instance];
                  }
                }
              }
            }

            function normalizeSignOff(v) {
              return (v === "1" || v === 1 || v === true || v === "Y") ? "1" : "";
            }

            // Actions -----------------------
            $scope.onUIChange = function () {
              if (!$scope.selections.user_interface) return;
              $scope.loadInstanceObjectTree();

              $scope.values.form = null;
              $scope.values.formOriginal = null;
              $scope.values.selected_tm1_object = null;
              $scope.values.selected_tm1_object_id = null;
            };

            $scope.onToggleInstance = function (data, $event) {
              if ($event && $event.stopPropagation) $event.stopPropagation();
              data.expanded = !data.expanded;
            
              $scope.values.form = null;
              $scope.values.formOriginal = null;
              $scope.values.selected_tm1_object = null;
              $scope.values.selected_tm1_object_id = null;
            };

            $scope.toggleTreeNode = function (node, $event) {
              if ($event) $event.stopPropagation();
              node.expanded = !node.expanded;
            };

            $scope.$on('tree:select', function (evt, payload) {
              evt.stopPropagation && evt.stopPropagation();
            
              $scope.values.selected_tm1_object = payload;      
              $scope.values.selected_tm1_object_id = payload.node._id;

              if (!payload.node.info) payload.node.info = {};
              payload.node.info["Managers Sign Off"] = normalizeSignOff(payload.node.info["Managers Sign Off"]);

              $scope.values.form = payload.node.info;
              $scope.values.formOriginal = angular.copy($scope.values.form);
            
            });

            $scope.onFieldChange = function (fieldKey) {
              const curSel = $scope.values.selected_tm1_object || {};
              const instance = curSel.instance;
              const node = curSel.node;
              if (!instance || !node) return;

              if (fieldKey === "Managers Sign Off") {
                $scope.values.form[fieldKey] = normalizeSignOff($scope.values.form[fieldKey]);
              }
            
              const tm1Object = node.tm1_object;
              const cur = $scope.values.form[fieldKey];         
              const old = $scope.values.formOriginal[fieldKey];
            
              if (cur === old) {
                // update to orginal -> remove from updates 
                if ($scope.values.updates[instance]?.[tm1Object]?.hasOwnProperty(fieldKey)) {
                  delete $scope.values.updates[instance][tm1Object][fieldKey];
                  cleanupUpdatesBucketIfEmpty(instance, tm1Object);
                }
              } else {
                ensureUpdatesMetaWithOriginal(instance, tm1Object, $scope.values.formOriginal);
                // new update -> add to updates
                const bucket = ensureUpdatesBucket(instance, tm1Object);
                bucket[fieldKey] = cur;
              }
              node.info[fieldKey] = cur;
            };

            $scope.hasUpdates = function () {
              return Object.keys($scope.values.updates).length > 0;
            };

            $scope.onSaveAll = function () {
              if (!$scope.hasUpdates()) return;
              $scope.values.loading = true;
              $scope.values.error = null;
            
          
              const body = buildUpdatePayloadsFromUpdates();
              if (!body.length) {
                $scope.values.loading = false;
                return;
              }
            
              const url = "/Cubes('" + CUBE_NAME + "')/tm1.Update";       
            
              $tm1.async(FIXED_INSTANCE, "POST", url, body)
                .then(function (res) {
                  $scope.values.updates = {};
                  $scope.values.updatesMeta = {};

                  if ($scope.values.selected_tm1_object &&
                      $scope.values.selected_tm1_object.node &&
                      $scope.values.selected_tm1_object.node.info) {
                    $scope.values.formOriginal = angular.copy($scope.values.form);
                    $scope.values.selected_tm1_object.node.info = angular.copy($scope.values.form);
                  }
                })
                .catch(function (err) {
                  $scope.values.error =
                    (err && err.data && err.data.error && err.data.error.message) ||
                    err.statusText ||
                    err.message ||
                    "Save failed";
                })
                .finally(function () {
                  $scope.values.loading = false;
                  $scope.$applyAsync();
                });
            };

            $scope.onDiscardAll = function () {
              Object.keys($scope.values.updatesMeta).forEach(inst => {
                const perInst = $scope.values.updatesMeta[inst] || {};
                Object.keys(perInst).forEach(obj => {
                  const original = perInst[obj]?.original || {};
                  const node = findNodeByInstanceAndObject(inst, obj);
                  if (node) {
                    node.info = angular.copy(original);
                  }
                  const isCurrent = $scope.values.selected_tm1_object
                    && $scope.values.selected_tm1_object.instance === inst
                    && $scope.values.selected_tm1_object.node
                    && $scope.values.selected_tm1_object.node.tm1_object === obj;
            
                  if (isCurrent) {
                    $scope.values.form = angular.copy(original);
                    $scope.values.formOriginal = angular.copy(original);
                    $scope.values.selected_tm1_object.node.info = $scope.values.form;
                  }
                });
              });
            
              $scope.values.updates = {};
              $scope.values.updatesMeta = {};
            };

            //Trigger an event after the login screen
            $scope.$on("login-reload", function (event, args) {

            });

            //Close the tab
            $scope.$on("close-tab", function (event, args) {
                // Event to capture when a user has clicked close on the tab
                if (args.page == "arcTemplate" && args.instance == $scope.instance && args.name == null) {
                    // The page matches this one so close it
                    $rootScope.close(args.page, { instance: $scope.instance });
                }
            });

            //Trigger an event after the plugin closes
            $scope.$on("$destroy", function (event) {

            });
        }]
    };
});

arc.directive("treeNode", function ($compile) {
  return {
    restrict: "E",
    scope: {
      node: "=",
      instance: "=",
      selectedId: "="
    },
    template: `
      <li class="tree-node" ng-class="{'is-selected': selectedId === node._id}">
        <div class="tree-row"
             ng-click="$event.stopPropagation(); $emit('tree:select', { instance: instance, node: node })">
          <div class="caret-box"
               ng-class="{'hidden': !(node.nodes && node.nodes.length)}"
               ng-click="$event.stopPropagation(); (node.nodes && node.nodes.length) && (node.expanded = !node.expanded)">
            <i class="caret" ng-class="{'open': node.expanded}"></i>
          </div>
          <span class="tree-label">{{node.tm1_object}}</span>
        </div>
      </li>
    `,
    link: function (scope, element) {
      if (angular.isArray(scope.node.nodes) && scope.node.nodes.length) {
        const tpl = `
          <ul class="tree-children" ng-if="node.expanded">
            <tree-node
              ng-repeat="c in node.nodes track by c._id"
              node="c"
              instance="instance"
              selected-id="selectedId">
            </tree-node>
          </ul>`;
        element.append($compile(tpl)(scope));
      }
    }
  };
});



