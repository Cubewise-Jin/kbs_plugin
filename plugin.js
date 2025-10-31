
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
                  console.log("tree_data =", $scope.values.tree_data);
                })
                .catch((err) => {
                  $scope.values.error = err?.data?.error?.message || err?.statusText || "Load failed";
                })
                .finally(() => {
                  $scope.values.loading = false;
                  $scope.$applyAsync();
                });
            };

            // Actions -----------------------
            $scope.onUIChange = function () {
              if (!$scope.selections.user_interface) return;
              $scope.loadInstanceObjectTree();
            };

            $scope.toggleTreeNode = function (node, $event) {
              if ($event) $event.stopPropagation();
              node.expanded = !node.expanded;
            };

            $scope.onSelectNode = function (node, instance) {
              $scope.values.selected_tm1_object = { instance, node };
              $scope.values.selected_tm1_object_id = node._id;
              console.log('selected_tm1_object_id =', $scope.values.selected_tm1_object_id);
              console.log('selected =', $scope.values.selected_tm1_object);
            };

            $scope.$on('tree:select', function (evt, payload) {
              evt.stopPropagation && evt.stopPropagation();
            
              $scope.values.selected_tm1_object = payload;      
              $scope.values.selected_tm1_object_id = payload.node._id;

              console.log('selected_tm1_object_id =', $scope.values.selected_tm1_object_id);
              console.log('selected =', $scope.values.selected_tm1_object);
            
              // 這裡你可以順便把右側面板要的 info 帶走：
              // payload.node.info 內含 Requirement/How to Use/... 等欄位
              // console.log('SELECTED =>', payload.node._id, payload.node.info);
            });

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



